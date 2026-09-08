import { mappingTable } from '../categories.mjs';
import { guard, json } from './_lib.mjs';

export default guard(async (req, res) => json(res, 200, { groups: mappingTable() }));
