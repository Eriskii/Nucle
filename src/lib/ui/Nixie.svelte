<script lang="ts">
	// A row of cold-cathode indicator tubes. Each glass holds every numeral at
	// once, so the unlit stack shows faintly behind the one that's glowing.
	let { value, tubes = 0 }: { value: string; tubes?: number } = $props();

	const chars = $derived.by(() => {
		const out: { glyph: string; point: boolean }[] = [];
		for (const c of value) {
			if ((c === '.' || c === ',') && out.length) out[out.length - 1].point = true;
			else out.push({ glyph: c, point: false });
		}
		while (out.length < tubes) out.unshift({ glyph: '', point: false });
		return out;
	});
</script>

<span class="bank" role="img" aria-label={value}>
	{#each chars as c, i (i)}
		<span class="tube" aria-hidden="true">
			<span class="stack">8</span>
			<span class="lit">{c.glyph}</span>
			{#if c.point}<i class="point"></i>{/if}
		</span>
	{/each}
</span>

<style>
	.bank {
		display: inline-flex;
		gap: 1px;
		vertical-align: middle;
	}
	.tube {
		position: relative;
		display: inline-grid;
		place-items: center;
		width: 1.04em;
		height: 1.5em;
		overflow: hidden;
		border-radius: 0.5em 0.5em 0.2em 0.2em;
		font-family: 'Nixie One', 'PT Mono', monospace;
		background:
			repeating-linear-gradient(90deg, rgba(120, 90, 60, 0.13) 0 1px, transparent 1px 3px),
			radial-gradient(ellipse at 50% 58%, rgba(255, 112, 30, 0.2), rgba(20, 12, 8, 0.96) 72%);
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.11),
			inset 3px 2px 3px -2px rgba(255, 255, 255, 0.38),
			0 1px 2px #000;
	}
	.stack,
	.lit {
		grid-area: 1 / 1;
		line-height: 1;
	}
	.stack {
		color: rgba(150, 110, 80, 0.13);
	}
	.lit {
		color: #ffc684;
		font-weight: 700;
		-webkit-text-stroke: 0.3px #ffc684;
		text-shadow:
			0 0 2px #fff0d0,
			0 0 6px #ff7a1a,
			0 0 14px #ff5a00;
	}
	.point {
		position: absolute;
		right: 0.1em;
		bottom: 0.26em;
		width: 0.14em;
		height: 0.14em;
		border-radius: 50%;
		background: #ffb060;
		box-shadow: 0 0 5px #ff5a00;
	}
</style>
