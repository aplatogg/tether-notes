import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NoteBody } from "./note-body";

describe("NoteBody highlights", () => {
  it("renders a markdown highlight as a yellow mark on the share page", () => {
    const html = renderToStaticMarkup(<NoteBody body="before ==marked== after" />);

    expect(html).toContain('<mark data-color="yellow">marked</mark>');
  });

  it("renders stored html highlights and strips unsafe styling", () => {
    const html = renderToStaticMarkup(
      <NoteBody
        body={
          '<p><mark data-color="blue" style="position:fixed;inset:0">kept</mark>' +
          '<mark data-color="nonsense">clamped</mark></p>'
        }
      />,
    );

    expect(html).toContain('<mark data-color="blue">kept</mark>');
    expect(html).toContain('<mark data-color="yellow">clamped</mark>');
    expect(html).not.toContain("position:fixed");
  });
});