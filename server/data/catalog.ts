/**
 * The film programme: what the cinema is showing and about to show. Edit this list (and the halls'
 * rotation in server/data/schedule.ts) to change the programme, then run `npm run db:reset`.
 *
 * Every film here is real. Release dates, running times, ratings, directors and cast are as the
 * studios and cinema chains published them in November 2026; taglines and synopses are our own
 * short descriptions. Running times of films that have not opened yet can still change by a few
 * minutes — check them against the distributor's sheet when the print arrives.
 *
 * - `status` is not written here: a film is "now showing" from its release date on, "coming soon"
 *   before it, and the server works it out every day.
 * - `advanceBookingFrom`: from that day the film's opening week (release date + 6 days) is on sale,
 *   weeks before it opens. Leave it out and the film's shows go on sale with the regular 7-day schedule.
 * - Art: `poster` (2:3) and `backdrop` (16:9, also projected onto the hall's screen) default to
 *   public/posters/<id>.svg and public/backdrops/<id>.svg — text-free, the UI typesets the title.
 *   The SVGs shipped here are our own stand-ins; to use the distributor's key art, drop the files
 *   into public/posters and public/backdrops and set e.g. `poster: '/posters/<id>.jpg'`.
 * - Trailers are not set here: staff upload a video per film on the box-office page (/staff), and
 *   it plays on the hall's screen when a customer sits down (see server/trailers.ts).
 */
import type { Movie } from '../../shared/types';

/** A film as written in a catalogue file: everything the server derives or defaults is optional. */
export type CatalogMovie = Omit<Movie, 'status' | 'poster' | 'backdrop' | 'trailer' | 'advanceBookingFrom'> &
  Partial<Pick<Movie, 'poster' | 'backdrop' | 'advanceBookingFrom'>>;

/**
 * The film as the API serves it. `status` is a placeholder until the server sets it from the
 * release date (see applyReleaseStatus in server/catalog-store.ts).
 */
export const withDefaults = (movie: CatalogMovie): Movie => ({
  ...movie,
  status: 'coming_soon',
  poster: movie.poster ?? `/posters/${movie.id}.svg`,
  backdrop: movie.backdrop ?? `/backdrops/${movie.id}.svg`,
  advanceBookingFrom: movie.advanceBookingFrom ?? null,
  trailer: null,
});

const PROGRAMME: CatalogMovie[] = [
  {
    id: 'avengers-doomsday',
    title: { en: 'Avengers: Doomsday', ar: 'المنتقمون: يوم القيامة' },
    tagline: { en: 'Robert Downey Jr. returns to Marvel — as Doctor Doom.', ar: 'روبرت داوني جونيور يعود إلى مارفل… بدور دكتور دوم.' },
    synopsis: {
      en: "Victor von Doom rises as the gravest threat the multiverse has ever faced. To stop him, the Avengers must join forces with the Fantastic Four, the X-Men and Wakanda's defenders.",
      ar: 'يبرز فيكتور فون دوم أخطرَ تهديدٍ واجهه الكون المتعدّد على الإطلاق. ولإيقافه، لا بدّ للمنتقمين من توحيد صفوفهم مع الرباعي المذهل ورجال إكس وحُماة واكاندا.',
    },
    genres: ['action', 'adventure', 'sci_fi'],
    durationMin: 165,
    rating: '13+', // PG-13
    audio: 'en',
    subtitles: 'ar',
    formats: ['2D', '3D'],
    releaseDate: '2026-12-18',
    advanceBookingFrom: '2026-11-17',
    director: { en: 'Anthony and Joe Russo', ar: 'أنتوني وجو روسو' },
    cast: [
      { en: 'Robert Downey Jr.', ar: 'روبرت داوني جونيور' },
      { en: 'Chris Hemsworth', ar: 'كريس هيمسوورث' },
      { en: 'Chris Evans', ar: 'كريس إيفانز' },
      { en: 'Pedro Pascal', ar: 'بيدرو باسكال' },
      { en: 'Vanessa Kirby', ar: 'فانيسا كيربي' },
    ],
    score: 0, // no audience score before it opens
    accent: '#5FCB74',
    featured: true,
  },
  {
    id: 'dune-part-three',
    title: { en: 'Dune: Part Three', ar: 'كثيب: الجزء الثالث' },
    tagline: { en: "The final chapter of Denis Villeneuve's Dune saga.", ar: 'الفصل الختامي من ملحمة «كثيب» لدوني فيلنوف.' },
    synopsis: {
      en: "Years after the war on Arrakis, Paul Atreides rules as emperor while a holy war is waged in his name across the known universe — and those he defeated conspire to bring him down. Based on Frank Herbert's novel Dune Messiah.",
      ar: 'بعد سنواتٍ من حرب أراكيس، يحكم بول أتريديس إمبراطوراً بينما تُشَنّ باسمه حربٌ مقدّسة في أرجاء الكون المعروف، ويتآمر عليه مَن هزمهم للإطاحة به. عن رواية فرانك هربرت «مسيح الكثيب».',
    },
    genres: ['sci_fi', 'adventure', 'drama'],
    durationMin: 150,
    rating: '13+', // PG-13
    audio: 'en',
    subtitles: 'ar',
    formats: ['2D'],
    releaseDate: '2026-12-18',
    advanceBookingFrom: '2026-11-17',
    director: { en: 'Denis Villeneuve', ar: 'دوني فيلنوف' },
    cast: [
      { en: 'Timothée Chalamet', ar: 'تيموثي شالاميه' },
      { en: 'Zendaya', ar: 'زندايا' },
      { en: 'Florence Pugh', ar: 'فلورنس بيو' },
      { en: 'Robert Pattinson', ar: 'روبرت باتينسون' },
      { en: 'Jason Momoa', ar: 'جيسون موموا' },
    ],
    score: 0,
    accent: '#E49B4F',
    featured: true,
  },
];

export const CATALOG: Movie[] = PROGRAMME.map(withDefaults);
