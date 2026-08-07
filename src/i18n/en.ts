import type { Dict } from './ru.js';

export const en: Dict = {
  disclosure: {
    text: [
      "Hi! I'm Luma — a virtual AI character, not a real person.",
      'I can hold a conversation and remember preferences you choose to share.',
      '',
      "Don't send secrets, passwords, seed phrases, or payment details.",
      '',
      'By continuing, you accept the Rules and the Privacy Policy.',
    ].join('\n'),
    continue: 'Continue',
    rules: 'Rules',
    privacy: 'Privacy',
    deleteData: 'Delete my data',
    accepted: (trial: number) =>
      `Done. You have ${trial} free messages — just write me something.\n\n` +
      'To see what I remember, use /memory. Full command list — /help.',
    required: 'Please accept the rules first — tap "Continue" under the /start message.',
  },

  identity: {
    amAi: "I'm an AI character, not a human. A program that can hold a conversation.",
  },

  trial: {
    lowNotice: (left: number) =>
      `Just a note: ${left} messages left. Packs are in /shop if you need them.`,
    exhausted:
      'Your free messages are used up. What’s available next is in /shop.\n' +
      'No rush — drop by whenever it suits you.',
  },

  commands: {
    balance: (left: number) => `Messages remaining: ${left}`,
    help: [
      'What I can do:',
      '',
      '/shop — message packs',
      '/balance — messages remaining',
      '/memory — what I remember about you',
      '/forget_all — forget everything',
      '/export_data — export my data',
      '/privacy — how I handle data',
      '/help — this list',
    ].join('\n'),
    privacy: [
      'Briefly, about data:',
      '',
      '· Conversation content and memory are stored encrypted.',
      '· I save only harmless preferences, and only with your confirmation.',
      '· I never save health, politics, religion, finances, precise location, or passwords.',
      '· /memory to view, /forget_all to delete, /export_data to export.',
      '',
      "Don't send passwords, one-time codes, card details, or seed phrases.",
    ].join('\n'),
  },

  errors: {
    llmUnavailable:
      "I can't reply right now — something on my side. Try again in a minute.\n" +
      'The message was not charged.',
    killSwitch: 'Maintenance in progress, back shortly. No messages are being charged.',
    rateLimited: 'That was quick — give me a second to catch up.',
    dailyLimit: "That's enough for today. Let's continue tomorrow.",
    generic: 'Something went wrong. I logged it and will look into it.',
    blocked: "I can't help with that.",
  },
};
