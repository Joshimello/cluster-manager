const rawVersion = process.env.PLATFORM_VERSION?.trim();

export const platformVersion = rawVersion || 'development';
