// node --test categories.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, groupOf, isMapped, normalise, MAP_VERSION } from './categories.mjs';

const group = (names, expected) => {
  for (const n of names) assert.equal(groupOf(n), expected, `${n} should be ${expected}`);
};

test('the decisions taken: coffee is a drink, ice cream and cakes are desserts', () => {
  group(['Coffee', 'Drinks', 'Beverages', 'Chumma Chinese Cool The Mala'], 'drinks');
  group(['Ice Cream', 'Cakes', 'Cannoli & Mochi', 'Desserts', 'Chumma Chinese Sweet Endings'], 'desserts');
  group(['Pizza', 'Pasta', 'Appetizers', 'Secret Menu', 'Soups'], 'other');
});

test('case and spacing differences are the same category', () => {
  // Both spellings are live at different outlets.
  assert.equal(groupOf('beverages'), groupOf('Beverages'));
  assert.equal(normalise('  Drinks   [o] '), 'drinks');
});

test('channel suffixes fold into the base category', () => {
  group(['Drinks [o]', 'Drinks (Beverages) [online]', 'Drinks [online]'], 'drinks');
  group(['Desserts [o]', 'Desserts [online]'], 'desserts');
  // Variants nobody has used yet must still land in the right group rather
  // than appearing as a new category and deflating the share.
  assert.equal(groupOf('Ice Cream [online]'), 'desserts');
  assert.equal(groupOf('Coffee [o]'), 'drinks');
});

test('menu re-cuts are the same category as what they replaced', () => {
  // Three months of history contains all of these alongside the originals.
  // ₹2.28L of "New Drinks." was landing in Other before they were folded.
  group(['New Drinks.', 'NEW DRINKS.', 'New Drinks. [old]'], 'drinks');
  group(['New Desserts.', 'NEW DESSERTS.', 'DESSERTS.', 'Desserts. [old]'], 'desserts');
  group(['New sushi.', 'New Pizza', 'New Pizza [old]', 'NEW PASTAS.', '11.Dips'], 'other');
});

test('an explicit entry beats the loosening heuristic', () => {
  // 'Extra' and 'Extras' are both listed; loosening must not be needed to
  // reach them, and must not be able to override a name that is spelled out.
  assert.equal(isMapped('Extras'), true);
  assert.equal(isMapped('Extra'), true);
  assert.equal(groupOf('Coffee & Matcha'), 'drinks');
  assert.equal(groupOf('NEW COFFEE & MATCHA'), 'drinks');
});

test('size and occasion variants are caught by keyword, not enumerated', () => {
  // Listing every weight never converges — the next one is an order away.
  for (const n of ['CUSTOMER CAKE', '500gm Ice Cream', 'cake 500gm', '1kg cake']) {
    assert.equal(groupOf(n), 'desserts', n);
    assert.equal(classify(n).by, 'keyword', n);
  }
  assert.equal(groupOf('Cold Coffee 300ml'), 'drinks');
});

test('a booking beats the product word inside its name', () => {
  // Named after the customer, so every one is new.
  assert.equal(groupOf('zara BDAY event'), 'other');
  assert.equal(groupOf('KG Birthday Cake event'), 'other', 'a booking, not a dessert sale');
  // But the product category itself is still a dessert.
  assert.equal(groupOf('Birthday Cake'), 'desserts');
});

test('keyword matches are reported as such so they can be made explicit', () => {
  assert.equal(classify('Desserts').by, 'exact');
  assert.equal(classify('New Desserts.').by, 'loosened');
  assert.equal(classify('500gm Ice Cream').by, 'keyword');
  assert.equal(classify('Sourdough Club').by, null);
});

test('a genuinely new category is flagged, not silently absorbed', () => {
  assert.equal(isMapped('Sourdough Club'), false);
  assert.equal(groupOf('Sourdough Club'), 'other', 'still counted, just not classified');
  assert.equal(isMapped('New York Deep Dish'), false, 'the New- prefix rule cannot swallow a real name');
});

test('every category name seen in three months of live data is classified', () => {
  const seen = [
    'Pizza', 'Pasta', 'Appetizers', 'Sushi', 'Drinks', 'Desserts', 'Noodles', 'Dimsum',
    'Sides', 'Beverages', 'beverages', 'Mains', 'Secret Menu', 'Coffee', 'Rice', 'Salads',
    "APPETIZER'S[online]", 'Chumma Chinese Sides', 'Chumma Chinese Mains', 'Ice Cream',
    'Chumma Chinese Cool The Mala', 'Chumma Chinese Sweet Endings', 'Add-Ons', 'Ghaslet',
    'Cannoli & Mochi', 'Cakes', 'Breakfast Menu', 'Extras', 'Soups', 'Dips [Online]',
    'Secret Menu [C]', 'Ghaslet (Online)', 'New sushi.', 'New Noodles.', 'New Sides.',
    'New Pizza', 'New Dimsum.', 'New Drinks.', 'New Mains.', 'Event Orders', 'New Desserts.',
    'NEW PASTAS.', 'New rice.', 'New appetizers.', 'New Pizza [old]', 'COURTSIDE BRUNCH',
    'NEW DESSERTS.', 'Merchandise', 'PASTAS.', 'New Appetizers. [old]', 'DESSERTS.',
    'New Drinks. [old]', 'Court side Brunch', 'NEW SALADS.', 'Hot Sauce (Online)',
    'Small Ice cream', 'Pastas. [old]', 'NEW COFFEE & MATCHA', 'HOT SAUCE',
    'Medium Ice cream', 'Bakery', 'SALADS.', '11.Dips', 'Desserts. [old]', 'Extra',
    'Bhajiya Party', 'New Secret Menu 2026', 'Merch', 'zara BDAY event',
    'Ghaslet (Hot sauce)', 'CUSTOMER CAKE', '500gm Ice Cream', 'cake 500gm',
  ];
  const missed = seen.filter((n) => !isMapped(n));
  assert.deepEqual(missed, [], 'unclassified names would show as an amber warning on the page');
});

test('the map fingerprint is stable and non-empty', () => {
  assert.match(MAP_VERSION, /^[a-z0-9]+$/);
});
