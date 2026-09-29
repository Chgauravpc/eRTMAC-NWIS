import { handlers as legacy } from './legacy';
import { handlers as wells } from './wells';
import { handlers as geo } from './geo';
import { handlers as risk } from './risk';
import { handlers as alerts } from './alerts';
import { handlers as documents } from './documents';
import { handlers as auth } from './auth';

// Domain handlers come first so they win over the older catch-alls in legacy.js.
export const handlers = [...wells, ...geo, ...risk, ...alerts, ...documents, ...auth, ...legacy];
