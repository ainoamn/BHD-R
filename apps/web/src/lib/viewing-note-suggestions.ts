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
