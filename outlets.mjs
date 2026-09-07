// The outlet registry.
//
// `restID` is Petpooja's "Menu Sharing Sync Code", not the RID. The RID is kept
// only because that is the number Petpooja support asks for.
//
// Active outlets were verified against the live Orders API — each returns
// orders. The inactive ones were verified too, and return an empty array: the
// Orders API was never enabled for them (they carry Purchase + Transfer only).
// They are listed rather than omitted so the dashboard can say "not reporting"
// instead of showing a brand total that quietly excludes half the business.

export const OUTLETS = [
  { id: 'aiko-amd', name: 'Aiko (Ahmedabad)', brand: 'Aiko', rid: '134691', restID: 'z2ogsrb0', active: true },
  { id: 'aiko-surat', name: 'Aiko (Surat)', brand: 'Aiko', rid: '73492', restID: '1ce6t782', active: true },
  { id: 'capiche-amd', name: 'Capiche (Ahmedabad)', brand: 'Capiche', rid: '353369', restID: 'qvy5ze7s0c', active: true },
  { id: 'capiche-amd2', name: 'Capiche Ahmedabad 2.0', brand: 'Capiche', rid: '419174', restID: 'ihtnr4a7cy', active: true },
  { id: 'capiche-piplod', name: 'Capiche (Piplod)', brand: 'Capiche', rid: '21492', restID: 'ukrhzywj', active: true },
  { id: 'capiche-vesu', name: 'Capiche (Vesu)', brand: 'Capiche', rid: '344447', restID: '4tmaivhj', active: true },

  // Orders API not enabled — verified returning zero orders.
  { id: 'bookends-mobile', name: 'Bookends mobile', brand: 'Bookends', rid: '359628', restID: 'yvop12cq3m', active: false },
  { id: 'amd-bakery', name: 'Ahmedabad Bakery', brand: 'Bakery', rid: '410700', restID: 'eh0x8kt3d2', active: false },
  { id: 'surat-bakery', name: 'Surat Bakery', brand: 'Bakery', rid: '343448', restID: 'cjkf5gi2', active: false },
  { id: 'amd-store', name: 'Ahmedabad Store', brand: 'Store', rid: '358609', restID: '4pwgfxrzs2', active: false },
  { id: 'surat-store', name: 'Surat Store', brand: 'Store', rid: '117185', restID: 'd6pbazgs', active: false },
  { id: 'family', name: 'Family', brand: 'Store', rid: '394370', restID: 'x74bivacjk', active: false },
  { id: 'kg-birthday-cake', name: 'KG Birthday Cake', brand: 'Bakery', rid: '383611', restID: '9zrehnckm6', active: false },
  { id: 'odc', name: 'ODC', brand: 'ODC', rid: '423523', restID: 'jprtvkud2b', active: false },
  { id: 'odc-store', name: 'ODC Store', brand: 'ODC', rid: '404029', restID: '8okipxz7r5', active: false },
  { id: 'amd-prep', name: 'Ahmedabad Prep Kitchen', brand: 'Prep Kitchen', rid: '410150', restID: 'opw2xhc6vg', active: false },
  { id: 'surat-prep', name: 'Surat Prep Kitchen', brand: 'Prep Kitchen', rid: '376017', restID: 'kv4roawcjf', active: false },
];

export const INACTIVE_REASON = 'Orders API not enabled by Petpooja';

export const ACTIVE = OUTLETS.filter((o) => o.active);
export const INACTIVE = OUTLETS.filter((o) => !o.active);

export const BY_ID = new Map(OUTLETS.map((o) => [o.id, o]));

/** Brand names in display order, active outlets only. */
export const BRANDS = [...new Set(ACTIVE.map((o) => o.brand))];

export const outletsOfBrand = (brand) => ACTIVE.filter((o) => o.brand === brand);
