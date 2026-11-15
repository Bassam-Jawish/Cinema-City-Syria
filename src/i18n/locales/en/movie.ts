import { plural } from '../../plural';

/** Film page strings. */
export const movie = {
  back: 'All films',
  showtimes: 'Showtimes',
  pickDay: 'Choose a day',
  noShowsOnDay: 'No shows on this day. Try another date.',
  weekend: 'Weekend',
  bookSeats: 'Choose seats',
  started: 'Started',
  seatsLeft: plural({ one: '{count} left', other: '{count} left' }),
  priceFrom: 'from {price}',
  glasses3d: '3D glasses included',
  comingSoonTitle: 'Tickets go on sale soon',
  comingSoonBody: 'This film opens on {date}. Showtimes will appear here as soon as they are published.',
  about: 'About the film',
  details: 'Details',
  formats: 'Formats',
};
