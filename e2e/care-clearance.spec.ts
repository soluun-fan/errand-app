import { expect, test } from "@playwright/test";
import { PHONES, loginAs } from "./support";

/**
 * Direct childcare and eldercare are outside the launch offering. Helpers should only be asked
 * for credentials relevant to currently supported services.
 */
test("helper credentials focus on launch services, not care work", async ({ page, context }) => {
  await loginAs(context, PHONES.bat);
  await page.goto("/helper/badges");
  await expect(page.getByText("Жолооны үнэмлэх")).toBeVisible();
  await expect(page.getByText("Өөрийн машин")).toBeVisible();
  await expect(page.getByText("Хүүхэд харах")).toHaveCount(0);
  await expect(page.getByText("Ахмад, өвчтөн асрах")).toHaveCount(0);

  await page.goto("/helper/certificates");
  await expect(page.getByRole("radio", { name: "Сантехник" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Цахилгаан" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Цэвэрлэгээ" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Хүүхэд харах|Ахмад|Асаргаа/ })).toHaveCount(0);
});
