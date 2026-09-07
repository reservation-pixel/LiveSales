// Category → reporting group.
//
// Petpooja category names are free text typed per outlet, so one concept arrives
// spelled many ways. Three months of live data holds over a hundred distinct
// names for perhaps thirty real categories: `Beverages` and `beverages` are two,
// as are `Drinks`, `Drinks [o]`, `Drinks (Beverages) [online]`, `New Drinks.`
// and `New Drinks. [old]`.
//
// Classification runs in three layers, most specific first, and `classify`
// reports which one fired:
//
//   exact     the name is listed in MEMBERS below — the decision is written down
//   loosened  the same name under a menu re-cut (`New …`, `… [old]`, `11.Dips`)
//   keyword   a size or occasion variant that cannot be enumerated (`500gm Ice Cream`)
//
// Nothing else is guessed at. A name none of the three recognise still counts
// toward the totals, as Other, and is reported on the page — a new dessert
// category must be visible, not silently absorbed.
//
// The order matters: an explicit entry always beats a heuristic, so a name that
// the loosening or the keywords would get wrong can be fixed by listing it.

export const DESSERTS = 'desserts';
export const DRINKS = 'drinks';
export const OTHER = 'other';

// Names as they appear in the feed. Matching is on the normalised form, so
// `Desserts [o]`, `Desserts [online]` and `Desserts` all collapse to one entry
// here — the suffixed variants are listed anyway as documentation of what the
// live data actually contains.
const MEMBERS = {
  [DRINKS]: [
    'Drinks',
    'Drinks [o]',
    'Drinks (Beverages) [online]',
    'Beverages',
    'beverages',
    'Chumma Chinese Cool The Mala',
    'Coffee',
    'Coffee & Matcha',
  ],
  [DESSERTS]: [
    'Desserts',
    'Desserts [o]',
    'Desserts [online]',
    'Chumma Chinese Sweet Endings',
    'Ice Cream',
    'Small Ice cream',
    'Medium Ice cream',
    'Cannoli & Mochi',
    'Cakes',
    'Bakery',
  ],
  // Everything savoury, listed rather than left to fall through. Without this
  // OTHER and UNRECOGNISED would be the same thing, and the "new category"
  // warning would fire on every savoury category forever — burying the one case
  // it exists to catch, a new dessert or drinks category nobody has mapped yet.
  [OTHER]: [
    'Pizza', 'Pasta', 'Noodles', 'Rice', 'Sushi', 'Dimsum', 'Mains', 'Sides',
    'Appetizers', "APPETIZER'S", 'Salads', 'Soups', 'Breakfast Menu',
    'Secret Menu', 'Secret Menu 2026', 'Extras', 'Extra', 'Add-Ons', 'Dips', 'Ghaslet',
    'Chumma Chinese Sides', 'Chumma Chinese Mains',
    'Pastas', 'Hot Sauce', 'Bhajiya Party',
    // Not food service: catering, a one-off brunch menu, and retail goods.
    // They are real revenue, so they stay in the totals rather than being
    // dropped — but they are not part of the dessert/drinks question.
    'Event Orders', 'Courtside Brunch', 'Court side Brunch', 'Merchandise', 'Merch',
    'Ghaslet (Hot sauce)',
  ],
};

// Strip the channel suffix Petpooja appends to online-menu duplicates of a
// category: `Pizza [online]`, `Sushi [o]`, `Secret Menu [C]`, `Ghaslet (Online)`.
// Without this, every new online variant of a dessert category would land in
// OTHER and quietly deflate the dessert share.
const CHANNEL_SUFFIX = /\s*[[(]\s*(?:o|c|online|dine[\s-]?in)\s*[\])]\s*$/i;

export const normalise = (name) =>
  String(name ?? '')
    .replace(CHANNEL_SUFFIX, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

// Outlets re-cut their menus in place rather than renaming categories, which
// leaves a generation of `New Drinks.`, `NEW DESSERTS.`, `Desserts. [old]` and
// `11.Dips` alongside the originals.
//
// This is not a tidying detail. About a fifth of all revenue arrives under a
// re-cut name, `New Drinks.` among the largest drinks categories in the data —
// unfolded, tens of lakhs of drinks and desserts sit in Other and both shares
// read low. Run scan-categories.mjs for the current split.
//
// Anything this mangles wrongly ends up unrecognised and shows on the page, so
// it cannot fail silently.
const loosen = (key) =>
  key
    .replace(/\s*\[\s*old\s*\]\s*$/, '')
    .replace(/^\d+\s*[.)]\s*/, '')
    .replace(/^new\s+/, '')
    .replace(/\.\s*$/, '')
    .trim();

// Last resort, and only for words that cannot mean anything else. Outlets sell
// the same dessert under a size or an occasion — `Small Ice cream`,
// `500gm Ice Cream`, `cake 500gm`, `CUSTOMER CAKE` — and listing each variant
// never converges, because the next weight is always one order away.
//
// Deliberately short. Anything arguable belongs in MEMBERS where the decision is
// written down, and `classify` reports what matched this way so it can be
// promoted rather than forgotten.
const KEYWORDS = [
  // Bookings first, and only on words that can mean nothing else. Event lines
  // are named after the customer — `zara BDAY event` — so each is new and would
  // raise the warning forever. They must also beat the dessert rule below:
  // `KG Birthday Cake event` is a booking, not a dessert sale, while a plain
  // `Birthday Cake` category is a product and stays a dessert.
  [OTHER, ['event', 'banquet', 'catering']],
  [DESSERTS, ['ice cream', 'icecream', 'cake', 'dessert', 'mochi', 'cannoli', 'brownie', 'gelato', 'pastry']],
  [DRINKS, ['coffee', 'matcha', 'beverage', 'drink', 'mocktail', 'milkshake', 'shake', 'latte', 'smoothie']],
];

const LOOKUP = new Map();
for (const [group, names] of Object.entries(MEMBERS)) {
  for (const n of names) LOOKUP.set(normalise(n), group);
}

/**
 * How a category was classified, and by what.
 * `by` is null when nothing recognised it — the case the dashboard flags.
 * @returns {{group: 'desserts'|'drinks'|'other', by: 'exact'|'loosened'|'keyword'|null}}
 */
export const classify = (categoryName) => {
  const key = normalise(categoryName);

  const exact = LOOKUP.get(key);
  if (exact) return { group: exact, by: 'exact' };

  const loosened = LOOKUP.get(loosen(key));
  if (loosened) return { group: loosened, by: 'loosened' };

  for (const [group, words] of KEYWORDS) {
    if (words.some((w) => key.includes(w))) return { group, by: 'keyword' };
  }

  return { group: OTHER, by: null };
};

/** @returns {'desserts'|'drinks'|'other'} */
export const groupOf = (categoryName) => classify(categoryName).group;

/** True when the name was recognised rather than falling through to OTHER. */
export const isMapped = (categoryName) => classify(categoryName).by !== null;

export const GROUP_LABELS = {
  [DESSERTS]: 'Desserts',
  [DRINKS]: 'Drinks',
  [OTHER]: 'Other',
};

// Cached day snapshots store the group split, so they are only valid for the
// map that produced them. Editing the lists below changes this fingerprint,
// which invalidates the cache and triggers a refetch — otherwise a map edit
// would appear to do nothing until the files were deleted by hand.
export const MAP_VERSION = (() => {
  // KEYWORDS is part of the mapping too — editing it must invalidate the cache
  // exactly as editing MEMBERS does.
  const seed = JSON.stringify([MEMBERS, KEYWORDS]);
  let h = 5381;
  for (let i = 0; i < seed.length; i += 1) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return h.toString(36);
})();

/** The mapping, for the README and the /api/categories route. */
export const mappingTable = () =>
  Object.entries(MEMBERS).map(([group, names]) => ({ group, label: GROUP_LABELS[group], names }));
