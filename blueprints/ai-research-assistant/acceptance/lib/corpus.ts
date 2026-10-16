// Source material for tests. Each document has its own vocabulary so that a
// citation to the wrong document is easy to spot.

export const SOLAR = {
  title: "Perovskite solar cells",
  text: [
    "Perovskite solar cells reached laboratory efficiencies above twenty-six percent within fifteen years of their first report.",
    "Their main weakness is stability: moisture, heat and ultraviolet light degrade the perovskite layer within months.",
    "Tandem cells that stack perovskite on top of silicon capture more of the spectrum than either material alone.",
    "Manufacturers are testing encapsulation films that keep water vapour away from the active layer for many years.",
  ].join("\n\n"),
};

export const COFFEE = {
  title: "Coffee roasting",
  text: [
    "Coffee roasting turns green beans brown through the Maillard reaction and caramelisation of sugars.",
    "First crack happens near one hundred ninety-six degrees Celsius, when steam pressure splits the bean.",
    "Light roasts keep more of the origin acidity, while dark roasts emphasise bitterness and body.",
    "Roasters log bean temperature every few seconds to reproduce a profile from batch to batch.",
  ].join("\n\n"),
};

export const TIDES = {
  title: "Ocean tides",
  text: [
    "Ocean tides are driven mainly by the gravitational pull of the Moon and, to a lesser degree, the Sun.",
    "Spring tides occur when the Sun and Moon align, producing higher high tides and lower low tides.",
    "Neap tides happen when the Sun and Moon pull at right angles, so the tidal range is smallest.",
    "Coastal engineers use tide tables to plan harbour construction around the lowest water levels.",
  ].join("\n\n"),
};

/** A document that must never leak into another workspace's answers. */
export const SECRET_PHRASE = "zebrafish lighthouse protocol 7731";
export const SECRET = {
  title: "Confidential memo",
  text: [
    `The ${SECRET_PHRASE} governs how night shifts hand over the beacon logs.`,
    "Only the harbour master may change the beacon schedule, and every change is countersigned.",
    "Tides near the lighthouse are checked twice per shift against the official tide table.",
  ].join("\n\n"),
};

export const QUESTION = "What are the main findings across these documents, and what limits do they mention?";
