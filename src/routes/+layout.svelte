<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import '@fontsource/share-tech-mono/400.css';
	import '@fontsource/barlow-condensed/500.css';
	import '@fontsource/barlow-condensed/600.css';
	import '@fontsource/courier-prime/400.css';
	import '@fontsource/courier-prime/700.css';
	import '@fontsource/nixie-one/400.css';
	import '@fontsource/pt-mono/400.css';
	import '@fontsource/pt-sans-narrow/400.css';
	import '@fontsource/pt-sans-narrow/700.css';
	import '@fontsource/reenie-beanie/400.css';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>NUCLE</title>
	<meta name="description" content="A daily nuclear strike planning puzzle on a 1960s air defense console." />
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--room: #070c12;
		--panel: #4c5b5c;
		--panel-dark: #38454a;
		--panel-edge: #29343a;
		--legend: #e3e5d3;
		--legend-dim: #b9c0ae;
		--phosphor: #86f7b0;
		--flash: #dcefff;
		--decay: #b9d873;
		--amber: #ffc24a;
		--alert: #ff6a45;
		--paper: #e7dfc4;
		--ink: #24231e;
		--engraved: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		--crt: 'Share Tech Mono', ui-monospace, monospace;
		--tty: 'Courier Prime', 'Courier New', monospace;
	}
	:global(html, body) {
		margin: 0;
		min-height: 100%;
		background: var(--room);
		color: var(--legend);
		font-family: var(--engraved);
		-webkit-font-smoothing: antialiased;
	}
	:global(*) {
		box-sizing: border-box;
	}
	:global(:focus-visible) {
		outline: 2px solid var(--flash);
		outline-offset: 2px;
	}
</style>
