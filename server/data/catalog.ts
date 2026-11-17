/**
 * The film programme: what the cinema is showing and about to show. Edit this list (and what each
 * hall plays, in server/data/schedule.ts) to change the programme, then run `npm run db:reset`.
 *
 * Every film here is real. The films now showing, their age ratings and their genres are as Cinema
 * City publishes them ("Now showing", 12–16 November 2026); release dates, running times,
 * directors and cast as the distributors, elCinema and the cinema chains list them. Taglines and
 * synopses are our own short descriptions. Running times of films that have not opened yet can
 * still change by a few minutes — check them against the distributor's sheet when the print arrives.
 *
 * - `status` is not written here: a film is "now showing" from its release date on, "coming soon"
 *   before it, and the server works it out every day.
 * - `advanceBookingFrom`: from that day the film's opening week (release date + 6 days) is on sale,
 *   weeks before it opens. Leave it out and the film's shows go on sale with the regular 7-day schedule.
 * - Art: `poster` (2:3) and `backdrop` (16:9, also projected onto the hall's screen) default to
 *   public/posters/<id>.svg and public/backdrops/<id>.svg. The films now showing use the posters
 *   from Cinema City's own listing (`.jpg`), each with a backdrop made from it; the two December
 *   films have our own text-free stand-ins until their posters arrive. To use other art, drop the
 *   files into public/posters and public/backdrops and set e.g. `poster: '/posters/<id>.jpg'`.
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

/** Art cut from Cinema City's own "Now showing" listing. */
const listingArt = (id: string) => ({ poster: `/posters/${id}.jpg`, backdrop: `/backdrops/${id}.jpg` });

const PROGRAMME: CatalogMovie[] = [
  // ── Now showing (Cinema City's programme of 12–16 November 2026) ──
  {
    id: 'hadota',
    title: { en: 'Hadota', ar: 'حدوتة' },
    tagline: { en: 'Ahmed Helmy is back on the big screen.', ar: 'أحمد حلمي يعود إلى الشاشة الكبيرة.' },
    synopsis: {
      en: 'Hadota, a man who lives outside the law, gets caught up in hiding a famous figure — then loses part of his memory. To recover what he forgot he turns to Dr. Hoda (Amina Khalil), a hypnotherapist, and comes face to face with the memories he has spent years running from.',
      ar: 'حدوتة رجلٌ يعيش خارج القانون، يتورّط في إخفاء شخصيةٍ شهيرة ثم يفقد جزءاً من ذاكرته. ولكي يستعيد ما نسيه يلجأ إلى الدكتورة هدى (أمينة خليل)، المعالِجة بالتنويم المغناطيسي، ليجد نفسه وجهاً لوجه مع ذكرياتٍ أمضى سنواتٍ يهرب منها.',
    },
    genres: ['comedy', 'drama'],
    durationMin: 120,
    rating: 'PG',
    audio: 'ar',
    subtitles: null,
    formats: ['2D'],
    releaseDate: '2026-11-12',
    director: { en: 'Mazen Ashraf', ar: 'مازن أشرف' },
    cast: [
      { en: 'Ahmed Helmy', ar: 'أحمد حلمي' },
      { en: 'Amina Khalil', ar: 'أمينة خليل' },
      { en: 'Maged El Masry', ar: 'ماجد المصري' },
      { en: 'Khaled El Sawy', ar: 'خالد الصاوي' },
      { en: 'Rahma Ahmed', ar: 'رحمة أحمد' },
    ],
    score: 0,
    accent: '#D9382E',
    featured: true,
    ...listingArt('hadota'),
  },
  {
    id: 'how-to-rob-a-bank',
    title: { en: 'How to Rob a Bank', ar: 'كيف تسرق بنكاً' },
    tagline: { en: 'Who’s robbing who?', ar: 'مَن يسرق مَن؟' },
    synopsis: {
      en: 'A crew of bank robbers turns its heists into viral livestreams — until a veteran FBI agent (John C. Reilly) enlists a brilliant software engineer under house arrest (Zoë Kravitz) to bring them down.',
      ar: 'عصابة لصوص مصارف تحوّل سرقاتها إلى بثٍّ مباشر يجتاح الإنترنت… إلى أن يستعين عميلٌ مخضرم في مكتب التحقيقات الفيدرالي (جون سي. رايلي) بمهندسة برمجيات بارعة تقضي فترة إقامةٍ جبرية (زوي كرافيتز) لإسقاطها.',
    },
    genres: ['action', 'crime', 'thriller'],
    durationMin: 122,
    rating: '16+', // R in the US; Cinema City shows +16
    audio: 'en',
    subtitles: 'ar',
    formats: ['2D'],
    releaseDate: '2026-11-12',
    director: { en: 'David Leitch', ar: 'ديفيد ليتش' },
    cast: [
      { en: 'Nicholas Hoult', ar: 'نيكولاس هولت' },
      { en: 'Zoë Kravitz', ar: 'زوي كرافيتز' },
      { en: 'John C. Reilly', ar: 'جون سي. رايلي' },
      { en: 'Pete Davidson', ar: 'بيت ديفيدسون' },
      { en: 'Anna Sawai', ar: 'آنا ساواي' },
    ],
    score: 0,
    accent: '#7BDB3A',
    featured: true,
    ...listingArt('how-to-rob-a-bank'),
  },
  {
    id: 'ramayana',
    title: { en: 'Ramayana', ar: 'رامايانا' },
    tagline: { en: 'Part one of the epic of Rama, Sita and Ravana.', ar: 'الجزء الأول من ملحمة راما وسيتا ورافانا.' },
    synopsis: {
      en: 'The first part of Nitesh Tiwari’s two-part retelling of the ancient Indian epic: the story of Prince Rama (Ranbir Kapoor), his wife Sita (Sai Pallavi) and Ravana (Yash), the demon king of Lanka.',
      ar: 'الجزء الأول من ثنائية نيتيش تيواري التي تعيد رواية الملحمة الهندية القديمة: حكاية الأمير راما (رانبير كابور) وزوجته سيتا (ساي بالافي) ورافانا (ياش)، ملك لانكا.',
    },
    genres: ['fantasy', 'adventure', 'action'],
    durationMin: 195,
    rating: '13+',
    audio: 'en', // released in Hindi and English
    subtitles: 'ar',
    formats: ['2D'],
    releaseDate: '2026-11-05',
    director: { en: 'Nitesh Tiwari', ar: 'نيتيش تيواري' },
    cast: [
      { en: 'Ranbir Kapoor', ar: 'رانبير كابور' },
      { en: 'Sai Pallavi', ar: 'ساي بالافي' },
      { en: 'Yash', ar: 'ياش' },
      { en: 'Sunny Deol', ar: 'صني ديول' },
      { en: 'Ravi Dubey', ar: 'رافي دوبي' },
    ],
    score: 0,
    accent: '#F0913F',
    featured: true,
    ...listingArt('ramayana'),
  },
  {
    id: 'wala-kan-al-bal',
    title: { en: 'Wala Kan Al Bal', ar: 'ولا كان عالبال' },
    tagline: { en: 'A love story nobody saw coming — in Luxor.', ar: 'قصة حبٍّ لم تكن على البال… في الأقصر.' },
    synopsis: {
      en: 'In Luxor, a young tour guide agrees to win over a wealthy businessman’s daughter in return for the businessman’s help with a dream of his own — until real feelings get tangled up in the deal.',
      ar: 'في الأقصر، يقبل مرشدٌ سياحيّ شاب عرضاً من رجل أعمال ثريّ: أن يكسب قلب ابنته مقابل مساعدته في تحقيق حلمه… إلى أن تختلط المشاعر الحقيقية بالصفقة.',
    },
    genres: ['romance', 'comedy'],
    durationMin: 88,
    rating: '13+',
    audio: 'ar',
    subtitles: null,
    formats: ['2D'],
    releaseDate: '2026-10-29', // in Syria (Egypt: 21 October)
    director: { en: 'Ahmed Emad', ar: 'أحمد عماد' },
    cast: [
      { en: 'Nour El Nabawy', ar: 'نور النبوي' },
      { en: 'Yasmina El Abd', ar: 'ياسمينا العبد' },
      { en: 'Ashraf Abdel Baky', ar: 'أشرف عبد الباقي' },
      { en: 'Marwan El Mosalamany', ar: 'مروان المسلماني' },
      { en: 'Joud El Sofiany', ar: 'جود السفياني' },
    ],
    score: 0,
    accent: '#F2A541',
    featured: false,
    ...listingArt('wala-kan-al-bal'),
  },
  {
    id: 'matloub-3a2leyan',
    title: { en: 'Matloub 3a2leyan', ar: 'مطلوب عائلياً' },
    tagline: { en: 'A family comedy with Karim Abdel Aziz and Yasmine Sabri.', ar: 'كوميديا عائلية مع كريم عبد العزيز وياسمين صبري.' },
    synopsis: {
      en: 'Farouk, a supermarket manager, is so taken up by his job that he has no time left for his wife Mai and their children — and life at home only gets more chaotic when Mai’s jobless brother Galal moves in.',
      ar: 'فاروق مدير متجرٍ كبير يستحوذ العمل على وقته كلّه، فلا يجد متّسعاً لزوجته مي وأطفالهما… وتزداد الفوضى في البيت حين ينتقل شقيق زوجته العاطل عن العمل، جلال، للإقامة معهم.',
    },
    genres: ['comedy', 'family'],
    durationMin: 90,
    rating: 'PG',
    audio: 'ar',
    subtitles: null,
    formats: ['2D'],
    releaseDate: '2026-10-08', // Arab markets (Egypt: 7 October)
    director: { en: 'Moataz El Tony', ar: 'معتز التوني' },
    cast: [
      { en: 'Karim Abdel Aziz', ar: 'كريم عبد العزيز' },
      { en: 'Yasmine Sabri', ar: 'ياسمين صبري' },
      { en: 'Mostafa Khater', ar: 'مصطفى خاطر' },
      { en: 'Sara Baraka', ar: 'سارة بركة' },
      { en: 'Samy Maghawry', ar: 'سامي مغاوري' },
    ],
    score: 0,
    accent: '#4AA8E0',
    featured: false,
    ...listingArt('matloub-3a2leyan'),
  },

  // ── Coming soon: opening week on advance sale ──
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
