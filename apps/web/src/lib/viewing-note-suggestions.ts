/**
 * Ready-made cheerful bilingual notes for the viewing desk — pick one, then polish with AI.
 */
export type ViewingNoteSuggestion = {
  id: string;
  labelAr: string;
  labelEn: string;
  textAr: string;
  textEn: string;
};

export const VIEWING_NOTE_SUGGESTIONS: readonly ViewingNoteSuggestion[] = [
  {
    id: 'south-gate',
    labelAr: 'البوابة الجنوبية',
    labelEn: 'South gate',
    textAr: 'مرحباً! الدخول من البوابة الجنوبية. يُرجى الاتصال قبل 15 دقيقة من الوصول — نتمنى لك معاينة موفقة 🚪☕',
    textEn:
      'Welcome! Please enter via the south gate. Call 15 minutes before arrival — wishing you a great viewing 🚪☕',
  },
  {
    id: 'parking',
    labelAr: 'موقف الزوار',
    labelEn: 'Visitor parking',
    textAr: 'موقف الزوار أمام المبنى. أظهر بطاقة المعاينة للحارس عند الوصول. يوم سعيد! 🅿️✨',
    textEn:
      'Visitor parking is in front of the building. Show your visit pass to the guard on arrival. Have a lovely day! 🅿️✨',
  },
  {
    id: 'calm-visit',
    labelAr: 'زيارة هادئة',
    labelEn: 'Calm visit',
    textAr: 'الموعد جاهز. خذ وقتك في المعاينة؛ نحن هنا لأي سؤال. بالتوفيق 🗝️🌿',
    textEn: 'Your slot is ready. Take your time viewing; we’re here for any question. Good luck 🗝️🌿',
  },
  {
    id: 'id-ready',
    labelAr: 'هوية جاهزة',
    labelEn: 'ID ready',
    textAr: 'يرجى إحضار هوية سارية وإظهار باركود بطاقة الزيارة عند البوابة. أهلاً بك! 🪪🤝',
    textEn: 'Please bring a valid ID and show the visit-pass barcode at the gate. Welcome! 🪪🤝',
  },
  {
    id: 'reschedule',
    labelAr: 'مرونة الموعد',
    labelEn: 'Flexible timing',
    textAr: 'إن احتجت تغييراً بسيطاً في الموعد أخبرنا مسبقاً وسنرتّب لك. نراكم قريباً 📅😊',
    textEn: 'If you need a small time change, tell us ahead and we’ll arrange it. See you soon 📅😊',
  },
  {
    id: 'coffee',
    labelAr: 'قهوة وترحاب',
    labelEn: 'Coffee & welcome',
    textAr: 'أهلاً بك في المبنى! القهوة العمانية بانتظارك بعد المعاينة إن أحببت ☕🌴',
    textEn: 'Welcome to the building! Omani coffee awaits after the viewing if you’d like ☕🌴',
  },
];

/** Guest-facing chips on the viewing pass (reschedule / cancel notes). */
export const GUEST_VIEWING_NOTE_SUGGESTIONS: readonly ViewingNoteSuggestion[] = [
  {
    id: 'after-work',
    labelAr: 'بعد العمل',
    labelEn: 'After work',
    textAr: 'أحتاج موعداً مساءً بعد دوامي إن أمكن. شكراً لتفهّمكم.',
    textEn: 'I need an evening slot after work if possible. Thank you for understanding.',
  },
  {
    id: 'traffic',
    labelAr: 'ازدحام',
    labelEn: 'Traffic delay',
    textAr: 'قد أتأخر قليلاً بسبب الزحام. هل يمكن تأجيل الموعد نصف ساعة؟',
    textEn: 'I may be slightly late due to traffic. Could we push the visit by about 30 minutes?',
  },
  {
    id: 'family',
    labelAr: 'مع العائلة',
    labelEn: 'With family',
    textAr: 'سأحضر مع أفراد من العائلة؛ نفضّل موعداً في عطلة نهاية الأسبوع.',
    textEn: 'I will come with family members; a weekend slot would work better for us.',
  },
  {
    id: 'cannot-make',
    labelAr: 'تعذّر الحضور',
    labelEn: 'Cannot attend',
    textAr: 'أعتذر، لن أتمكن من الحضور في الموعد الحالي. أرجو إلغاءه أو اقتراح بديل.',
    textEn: 'Sorry, I cannot make the current appointment. Please cancel it or suggest another time.',
  },
  {
    id: 'thanks',
    labelAr: 'شكر وترتيب',
    labelEn: 'Thanks',
    textAr: 'شكراً لترتيب الموعد. أرجو تأكيد الوقت الجديد عبر الرسالة.',
    textEn: 'Thank you for arranging the visit. Please confirm the new time by message.',
  },
];
