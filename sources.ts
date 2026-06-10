/**
 * AppViews whose trusted-verifier sets the scraper tracks, mapped to their public XRPC service.
 */
export const sources = {
	blacksky: 'https://api.blacksky.community',
	bluesky: 'https://api.bsky.app',
} as const;

/**
 * Identifier of a tracked AppView source.
 */
export type Source = keyof typeof sources;
