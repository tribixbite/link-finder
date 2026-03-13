#!/usr/bin/env bun
/**
 * Vite CLI wrapper for Termux/Android compatibility.
 * Runs Vite directly through Bun instead of via npx/bunx.
 */
import { createServer, build, preview } from 'vite';

const cmd = process.argv[2];

if (cmd === 'dev') {
	const server = await createServer({ configFile: 'vite.config.ts' });
	await server.listen();
	server.printUrls();
} else if (cmd === 'build') {
	await build({ configFile: 'vite.config.ts' });
} else if (cmd === 'preview') {
	const server = await preview({ configFile: 'vite.config.ts' });
	server.printUrls();
} else {
	console.error('Usage: bun ./scripts/vite-cli.ts [dev|build|preview]');
	process.exit(1);
}
