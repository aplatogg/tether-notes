import { expect, test } from "vitest";

test("provides the browser test environment", () => {
  const element = document.createElement("div");
  document.body.append(element);

  expect(element).toBeInTheDocument();
  expect(indexedDB).toBeDefined();
});
