// Source material for tests: the help-centre documents of a small lamp shop. Each document has its own
// vocabulary, and each question below shares its keywords (spec/architecture.md §5: lower-case words of
// five or more letters, not stop words) with exactly one document, so which document must be cited — or
// that nothing can be cited — follows from the fake model's rule alone.

export const REFUNDS = {
  title: "Refund policy",
  text: [
    "Customers may request a refund within thirty days of delivery by writing to our help desk.",
    "Approved refunds are paid back to the original payment method within five business days.",
    "Opened bulbs cannot be returned for hygiene and safety reasons.",
  ].join("\n\n"),
};

export const SHIPPING = {
  title: "Shipping and delivery",
  text: [
    "Orders leave our Rotterdam warehouse every weekday before four in the afternoon.",
    "Standard delivery inside the Netherlands takes two working days.",
    "International parcels are tracked with a courier number that we send by email.",
  ].join("\n\n"),
};

export const WARRANTY = {
  title: "Lamp warranty",
  text: [
    "Every lamp carries a two-year warranty against manufacturing defects.",
    "Warranty claims need the order number and a photo of the defect.",
    "Damage caused by plugging a lamp into the wrong voltage is not covered.",
  ].join("\n\n"),
};

/** Keywords "refund", "arrives": only REFUNDS has one. */
export const Q_REFUND = "How many days until my refund arrives?";
/** Keywords "warehouse", "ships", "orders": only SHIPPING has one. */
export const Q_SHIPPING = "Which warehouse ships the orders?";
/** Keywords "broken", "covered", "warranty": only WARRANTY has one. */
export const Q_WARRANTY = "Is a broken lamp covered by the warranty?";
/** Keywords "submarine", "periscopes": no document has one, so it cannot be answered. */
export const Q_UNKNOWN = "Do you sell submarine periscopes?";

/** A document that must never leak into another workspace's answers. */
export const SECRET_PHRASE = "zebrafish lighthouse protocol 7731";
export const SECRET = {
  title: "Internal escalation memo",
  text: [
    `The ${SECRET_PHRASE} lets night staff issue goodwill vouchers to upset callers.`,
    "Every voucher above fifty euros must be countersigned by the duty manager.",
    "Vouchers are never promised in writing.",
  ].join("\n\n"),
};
/** Words of SECRET that are not in the question about it: if one shows up in an answer, the memo leaked. */
export const SECRET_LEAKS = ["goodwill", "vouchers", "countersigned", "duty manager", "night staff"];
/** Keywords "zebrafish", "lighthouse", "protocol": only SECRET has them. */
export const Q_SECRET = `What does the ${SECRET_PHRASE} say?`;

/**
 * A long manual (about 21,000 characters) with one relevant paragraph, which carries a canary code.
 * Used in real mode to check that the retrieved passage reaches the model, and the whole manual does not.
 */
export const CANARY = "QX-5521";
export const LONG_QUESTION = "How do I descale the brass espresso valve?";
export function longManual() {
  const paragraphs: string[] = [];
  for (let i = 1; i <= 220; i++) {
    paragraphs.push(`Catalogue entry ${i} lists colour options, cable lengths and packaging sizes for lamp model ${i}.`);
    if (i === 120) {
      paragraphs.push(`To descale the brass espresso valve, soak it overnight in a citric acid bath; service code ${CANARY} applies.`);
    }
  }
  return { title: "Showroom manual", text: paragraphs.join("\n\n") };
}

/**
 * The same check in Chinese (customers and visitors are mostly Chinese): a long manual (about 19,000
 * characters, 600 catalogue lines) with one relevant paragraph that carries a per-run nonce. No character of the
 * question appears in the catalogue lines, so only a retrieval that handles Chinese (spec/architecture.md §5,
 * "向量化": Han character 2-grams by default) finds the passage; splitting on spaces or Latin letters leaves the
 * question with an empty vector, and the passage then reaches the prompt only by chance.
 */
export const ZH_QUESTION = "黄铜咖啡阀门怎么除垢？";
export function longChineseManual(nonce: string) {
  const paragraphs: string[] = [];
  for (let i = 1; i <= 600; i++) {
    paragraphs.push(`第${i}号台灯的目录条目列出了颜色选项、电线长度和包装尺寸。`);
    if (i === 400) paragraphs.push(`黄铜咖啡阀门的除垢方法：把阀门放进柠檬酸溶液里浸泡一整夜，维修代码是 ${nonce}。`);
  }
  return { title: "展厅手册", text: paragraphs.join("\n\n") };
}
