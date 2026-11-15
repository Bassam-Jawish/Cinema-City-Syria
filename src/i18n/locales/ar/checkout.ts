import type { checkout as en } from '../en/checkout';

/** Arabic twin of ../en/checkout.ts. */
export const checkout: typeof en = {
  title: 'تأكيد الحجز',
  backToSeats: 'العودة إلى اختيار المقاعد',
  step: 'الخطوة {current} من {total}',
  details: {
    title: 'بياناتك',
    name: 'الاسم الكامل',
    namePlaceholder: 'مثال: لينا حداد',
    phone: 'رقم الموبايل',
    phonePlaceholder: '09XX XXX XXX',
    phoneHint: 'نرسل رقم الحجز إلى هذا الرقم.',
    nameError: 'يرجى إدخال اسمك (حرفان على الأقل).',
    phoneError: 'يرجى إدخال رقم موبايل سوري، مثل 0944 123 456.',
  },
  payment: {
    title: 'الدفع',
    boxOffice: 'الدفع عند شبّاك التذاكر',
    boxOfficeBody: 'احجز الآن وادفع نقداً عند استلام التذاكر، قبل العرض بـ15 دقيقة على الأقل.',
    online: 'الدفع الإلكتروني',
    onlineBody: 'عبر محفظة إلكترونية مثل شام كاش أو سيريتل كاش.',
    demoBadge: 'تجريبي',
    onlineDemoNote: 'في هذه النسخة التجريبية لا يُقتطع أي مبلغ: الدفع محاكاة فقط.',
    recommended: 'الأكثر استخداماً',
  },
  summary: {
    title: 'ملخص الطلب',
    seats: 'المقاعد',
    perSeat: '{count} × {price}',
    glasses: 'يشمل النظارات ثلاثية الأبعاد',
    total: 'الإجمالي',
  },
  confirm: 'تأكيد الحجز',
  confirmPay: 'ادفع {total} واحجز',
  processing: 'جارٍ تأكيد حجزك…',
  paying: 'جارٍ معالجة الدفع…',
  terms: 'بتأكيد الحجز توافق على الحضور قبل العرض بـ15 دقيقة. يمكن إلغاء الحجز حتى موعد بدء العرض.',
  empty: {
    title: 'لا توجد مقاعد مختارة',
    body: 'لم تعد مقاعدك محجوزة مؤقتاً — ربما أُعيدت بعد انتهاء الوقت.',
    action: 'اختر المقاعد',
  },
  errors: {
    seatsTaken: 'عذراً — سبقك أحدهم إلى {seats}. يرجى الاختيار من جديد.',
    generic: 'تعذّر إتمام الحجز. حاول مجدداً.',
  },
};
