import { test } from "node:test";
import assert from "node:assert/strict";

import { parseBudgetMatrix } from "./budgetMatrix";

test("matrix: regel met 12 maandbedragen wordt overgenomen", () => {
  const text = "Boodschappen\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t100,00\t150,00";
  const { rows, errors } = parseBudgetMatrix(text);
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "Boodschappen");
  assert.equal(rows[0]!.monthsCents.length, 12);
  assert.equal(rows[0]!.monthsCents[11], 15_000);
  assert.equal(rows[0]!.monthsCents.reduce((a, b) => a + b, 0), 11 * 10_000 + 15_000);
});

test("matrix: regel met één gemiddelde wordt gelijk verdeeld", () => {
  const { rows, errors } = parseBudgetMatrix("Zorgverzekering;135,50");
  assert.equal(errors.length, 0);
  assert.equal(rows[0]!.monthsCents.every((c) => c === 13_550), true);
});

test("matrix: Nederlandse duizendtallen worden correct gelezen", () => {
  const { rows } = parseBudgetMatrix("Hypotheek,1.234,56");
  // komma-gescheiden + komma-decimaal is dubbelzinnig; hier kiest de parser komma
  // als scheidingsteken, dus '1.234' en '56' → 2 bedragen → fout. Daarom puntkomma/tab gebruiken.
  // Deze test borgt dat tab/puntkomma wél werkt:
  const ok = parseBudgetMatrix("Hypotheek\t1.234,56");
  assert.equal(ok.rows[0]!.monthsCents[0], 123_456);
});

test("matrix: lege regels worden genegeerd, foute regels gemeld", () => {
  const text = "\nBenzine\t50,00\nKapot\tabc\n";
  const { rows, errors } = parseBudgetMatrix(text);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.name, "Benzine");
  assert.equal(errors.length, 1);
});

test("matrix: verkeerd aantal kolommen geeft een nette fout", () => {
  const { rows, errors } = parseBudgetMatrix("Water\t10,00\t20,00\t30,00");
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
});
