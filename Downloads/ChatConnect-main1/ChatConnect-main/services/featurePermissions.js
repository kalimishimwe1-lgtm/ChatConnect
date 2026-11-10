const FEATURE_PERMISSIONS = [
    { key: "messaging", label: "Direct text and image messaging" },
    { key: "groups", label: "Private group creation and messaging" },
    { key: "audio_calls", label: "Audio calls" },
    { key: "video_calls", label: "Video calls" },
    { key: "voice_notes", label: "Voice notes" },
    { key: "search", label: "Contact and message search" },
    { key: "profile", label: "Profile editing and profile pictures" },
    { key: "presence", label: "Presence status changes" },
];

const FEATURE_KEYS = FEATURE_PERMISSIONS.map(({ key }) => key);

module.exports = { FEATURE_PERMISSIONS, FEATURE_KEYS };
