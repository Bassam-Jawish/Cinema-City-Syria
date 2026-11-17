import { plural } from '../../plural';
import type { movie as en } from '../en/movie';

/** Arabic twin of ../en/movie.ts. */
export const movie: typeof en = {
  back: 'كل الأفلام',
  showtimes: 'مواعيد العرض',
  pickDay: 'اختر اليوم',
  noShowsOnDay: 'لا عروض في هذا اليوم. جرّب تاريخاً آخر.',
  weekend: 'عطلة',
  bookSeats: 'اختر المقاعد',
  started: 'بدأ العرض',
  seatsLeft: plural({
    zero: 'لا مقاعد',
    one: 'مقعد واحد',
    two: 'مقعدان',
    few: '{count} مقاعد',
    many: '{count} مقعداً',
    other: '{count} مقعد',
  }),
  priceFrom: 'ابتداءً من {price}',
  glasses3d: 'مع نظارات ثلاثية الأبعاد',
  comingSoonTitle: 'الحجز يُفتح قريباً',
  comingSoonBody: 'يبدأ عرض هذا الفيلم في {date}. ستظهر المواعيد هنا فور الإعلان عنها.',
  advanceBadge: 'حجز مسبق',
  advanceTitle: 'الحجز المسبق مفتوح',
  advanceBody: 'يبدأ عرضه في {date}. احجز مقاعدك لأسبوع العرض الأول من الآن، واجلس فيها أولاً في الصالة ثلاثية الأبعاد والإعلان الترويجي على الشاشة.',
  about: 'عن الفيلم',
  details: 'التفاصيل',
  formats: 'صيغ العرض',
};
