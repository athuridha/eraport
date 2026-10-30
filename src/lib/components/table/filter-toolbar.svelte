<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/icon.svelte';

	interface Opsi {
		value: string;
		label: string;
	}

	interface Pilih {
		name: string;
		label: string;
		value: string;
		opsis: Opsi[];
		onChange: (value: string) => void;
	}

	interface Tanggal {
		dari: string;
		sampai: string;
		onChange: (v: { dari: string; sampai: string }) => void;
	}

	interface Props {
		q?: string;
		qPlaceholder?: string;
		onSearch?: (value: string) => void;
		pilih?: Pilih[];
		tanggal?: Tanggal | undefined;
		aktif?: number;
		onReset?: () => void;
		children?: Snippet;
	}

	let {
		q = $bindable(''),
		qPlaceholder = 'Cari...',
		onSearch,
		pilih = [],
		tanggal,
		aktif = 0,
		onReset,
		children
	}: Props = $props();

	const SEARCH_DEBOUNCE_MS = 350;
	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingSearch = '';

	// Read from the event, not `q`: avoids depending on binding update order.
	function handleSearchInput(event: Event) {
		pendingSearch = (event.currentTarget as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			searchTimer = undefined;
			onSearch?.(pendingSearch);
		}, SEARCH_DEBOUNCE_MS);
	}

	// Flush the pending debounced search before the component goes away.
	onDestroy(() => {
		if (!searchTimer) return;
		clearTimeout(searchTimer);
		searchTimer = undefined;
		onSearch?.(pendingSearch);
	});

	let dariInput: HTMLInputElement | undefined = $state();
	let sampaiInput: HTMLInputElement | undefined = $state();

	function handleTanggalChange() {
		if (!tanggal) return;
		tanggal.onChange({
			dari: dariInput?.value ?? tanggal.dari,
			sampai: sampaiInput?.value ?? tanggal.sampai
		});
	}
</script>

<div class="flex w-full flex-wrap items-stretch gap-2">
	<div class="join flex min-w-0 grow flex-wrap">
		<label class="input input-bordered join-item min-w-40 grow">
			<Icon name="search" />
			<input
				type="search"
				bind:value={q}
				placeholder={qPlaceholder}
				spellcheck="false"
				autocomplete="off"
				oninput={handleSearchInput}
			/>
		</label>

		{#each pilih as filter (filter.name)}
			<select
				class="select select-bordered join-item w-auto max-w-52 shrink"
				aria-label={filter.label}
				value={filter.value}
				onchange={(event) => filter.onChange((event.currentTarget as HTMLSelectElement).value)}
			>
				{#each filter.opsis as opsi (opsi.value)}
					<option value={opsi.value}>{opsi.label}</option>
				{/each}
			</select>
		{/each}

		{#if tanggal}
			<label class="input input-bordered join-item shrink-0">
				<span class="text-xs opacity-70">Dari</span>
				<input
					type="date"
					bind:this={dariInput}
					value={tanggal.dari}
					onchange={handleTanggalChange}
				/>
			</label>
			<label class="input input-bordered join-item shrink-0">
				<span class="text-xs opacity-70">Sampai</span>
				<input
					type="date"
					bind:this={sampaiInput}
					value={tanggal.sampai}
					onchange={handleTanggalChange}
				/>
			</label>
		{/if}
	</div>

	{#if aktif > 0 || children}
		<div class="flex flex-wrap items-center gap-2">
			{#if aktif > 0}
				<button type="button" class="btn btn-soft" onclick={() => onReset?.()}>Reset</button>
			{/if}
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</div>
