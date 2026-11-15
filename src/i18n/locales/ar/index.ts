import type { en } from '../en';
import { admin } from './admin';
import { checkout } from './checkout';
import { common } from './common';
import { home } from './home';
import { movie } from './movie';
import { seats } from './seats';
import { ticket } from './ticket';

export const ar: typeof en = { common, home, movie, seats, checkout, ticket, admin };
