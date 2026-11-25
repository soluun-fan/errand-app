/** Generate client types from the migrations in disposable Postgres, without Docker or hosted credentials. */
import { readFile, writeFile } from "node:fs/promises";
import { format, resolveConfig } from "prettier";
import { createSchemaDb } from "./lib/schema-db";

interface PgType {
  oid: number;
  name: string;
  schema: string;
  kind: string;
  element: number;
  relation: number;
}
interface Column {
  name: string;
  type: number;
  nullable: boolean;
  optional: boolean;
  generated: boolean;
}
interface Relation {
  oid: number;
  name: string;
  kind: string;
}
interface Relationship {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}
interface Fn {
  name: string;
  names: string[] | null;
  types: number[];
  modes: string[] | null;
  defaults: number;
  result: number;
  set: boolean;
}

async function main() {
  const db = await createSchemaDb();
  try {
    const types = (
      await db.query<PgType>(`select t.oid::int, t.typname as name, n.nspname as schema,
    t.typtype as kind, t.typelem::int as element, t.typrelid::int as relation
    from pg_type t join pg_namespace n on n.oid = t.typnamespace`)
    ).rows;
    const byType = new Map(types.map((t) => [t.oid, t]));
    const relations = (
      await db.query<Relation>(`select c.oid::int, c.relname as name, c.relkind as kind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') order by c.relname`)
    ).rows;
    const byRelation = new Map(relations.map((r) => [r.oid, r]));
    const enums = (
      await db.query<{ oid: number; label: string }>(`select enumtypid::int as oid, enumlabel as label
    from pg_enum order by enumtypid, enumsortorder`)
    ).rows;
    const enumTypes = types.filter((t) => t.schema === "public" && t.kind === "e").sort((a, b) => a.name.localeCompare(b.name));

    function tsType(oid: number): string {
      const t = byType.get(oid);
      if (!t) throw new Error(`Unknown PostgreSQL type ${oid}`);
      if (t.element) return `(${tsType(t.element)})[]`;
      if (t.kind === "e")
        return enums
          .filter((e) => e.oid === oid)
          .map((e) => JSON.stringify(e.label))
          .join(" | ");
      if (t.relation) {
        const relation = byRelation.get(t.relation);
        if (!relation) throw new Error(`Unsupported composite type ${t.schema}.${t.name}`);
        return `Database["public"]["${relation.kind === "v" || relation.kind === "m" ? "Views" : "Tables"}"][${JSON.stringify(relation.name)}]["Row"]`;
      }
      if (["int2", "int4", "int8", "float4", "float8", "numeric", "oid"].includes(t.name)) return "number";
      if (t.name === "bool") return "boolean";
      if (["json", "jsonb"].includes(t.name)) return "Json";
      if (t.name === "void") return "undefined";
      if (["trigger", "event_trigger"].includes(t.name)) return "never";
      if (
        [
          "text",
          "varchar",
          "bpchar",
          "char",
          "name",
          "uuid",
          "date",
          "timestamp",
          "timestamptz",
          "time",
          "timetz",
          "interval",
          "bytea",
          "inet",
          "cidr",
          "tsvector",
        ].includes(t.name)
      )
        return "string";
      throw new Error(`Unsupported PostgreSQL type ${t.schema}.${t.name}; add an explicit mapping`);
    }

    const render = (columns: Column[], mode: "Row" | "Insert" | "Update") => `{
${columns.map((c) => `  ${JSON.stringify(c.name)}${mode === "Update" || (mode === "Insert" && c.optional) ? "?" : ""}: ${c.generated && mode !== "Row" ? "never" : `${tsType(c.type)}${c.nullable ? " | null" : ""}`};`).join("\n")}
}`;
    const tables: string[] = [];
    const views: string[] = [];
    for (const relation of relations) {
      const columns = (
        await db.query<Column>(
          `select a.attname as name, a.atttypid::int as type,
      not a.attnotnull as nullable, (not a.attnotnull or a.atthasdef or a.attidentity <> '' or a.attgenerated <> '') as optional,
      (a.attgenerated <> '' or a.attidentity = 'a') as generated
      from pg_attribute a where a.attrelid = $1 and a.attnum > 0 and not a.attisdropped order by a.attnum`,
          [relation.oid],
        )
      ).rows;
      const relationships = (
        await db.query<Relationship>(
          `select c.conname as "foreignKeyName",
      array(select a.attname from unnest(c.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as columns,
      exists(select 1 from pg_constraint u where u.conrelid = c.conrelid and u.contype in ('p','u')
        and u.conkey @> c.conkey and u.conkey <@ c.conkey) as "isOneToOne",
      r.relname as "referencedRelation",
      array(select a.attname from unnest(c.confkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord) as "referencedColumns"
      from pg_constraint c join pg_class r on r.oid = c.confrelid
      join pg_namespace n on n.oid = r.relnamespace
      where c.conrelid = $1 and c.contype = 'f' and n.nspname = 'public' order by c.conname`,
          [relation.oid],
        )
      ).rows;
      const definition = `${JSON.stringify(relation.name)}: {
Row: ${render(columns, "Row")};
Insert: ${render(columns, "Insert")};
Update: ${render(columns, "Update")};
Relationships: ${JSON.stringify(relationships)};
};`;
      (relation.kind === "v" || relation.kind === "m" ? views : tables).push(definition);
    }

    const functions = (
      await db.query<Fn>(`select p.proname as name, p.proargnames as names,
    coalesce(p.proallargtypes, p.proargtypes::oid[])::int[] as types, p.proargmodes as modes,
    p.pronargdefaults as defaults, p.prorettype::int as result, p.proretset as set
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by p.proname, p.oid`)
    ).rows;
    const byName = new Map<string, string[]>();
    for (const fn of functions) {
      const args = fn.types.map((oid, i) => ({ oid, name: fn.names?.[i], mode: fn.modes?.[i] ?? "i" }));
      const inputs = args.filter((a) => ["i", "b", "v"].includes(a.mode));
      const outputs = args.filter((a) => ["o", "b", "t"].includes(a.mode));
      if (inputs.some((a) => !a.name)) throw new Error(`Unnamed RPC arguments in ${fn.name}`);
      const result = outputs.length
        ? `{
${outputs.map((a) => `${JSON.stringify(a.name)}: ${tsType(a.oid)} | null;`).join("\n")}
}`
        : tsType(fn.result);
      const def = `{
Args: ${
        inputs.length
          ? `{
${inputs.map((a, i) => `${JSON.stringify(a.name)}${i >= inputs.length - fn.defaults ? "?" : ""}: ${tsType(a.oid)} | null;`).join("\n")}
}`
          : "Record<PropertyKey, never>"
      };
Returns: ${result}${fn.set ? "[]" : ""};
}`;
      byName.set(fn.name, [...(byName.get(fn.name) ?? []), def]);
    }

    const output = `// Generated from supabase/migrations by npm run db:types. Do not edit.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type Database = {
public: {
Tables: { ${tables.join("\n")} };
Views: { ${views.join("\n")} };
Functions: { ${[...byName].map(([name, defs]) => `${JSON.stringify(name)}: ${defs.join(" | ")};`).join("\n")} };
Enums: { ${enumTypes.map((t) => `${JSON.stringify(t.name)}: ${tsType(t.oid)};`).join("\n")} };
CompositeTypes: Record<never, never>;
};
};
export type Tables<Name extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][Name]["Row"];
`;
    const path = "src/lib/db/database.types.ts";
    const formatted = await format(output, { ...(await resolveConfig(path)), parser: "typescript" });
    if (process.argv.includes("--check")) {
      if ((await readFile(path, "utf8")) !== formatted)
        throw new Error("Database types are stale. Run npm run db:types and commit the result.");
      console.log("Database types match the migrations.");
    } else {
      await writeFile(path, formatted);
      console.log(`Generated ${relations.length} relations and ${byName.size} RPC types.`);
    }
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
