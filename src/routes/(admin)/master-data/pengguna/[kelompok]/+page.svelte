<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/icon.svelte';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import FilterToolbar from '$lib/components/table/filter-toolbar.svelte';
	import { toast } from '$lib/components/toast.svelte';
	import { buildPageNumbers, OPSI_BARIS_PER_HALAMAN } from '$lib/utils/pagination';
	import { selectAll, semuaTerpilih, toggleId } from '$lib/utils/bulk-select';
	import { setFilter, resetFilters, countActiveFilters } from '$lib/utils/url-filter';

	const KUNCI_FILTER = ['q', 'role'];

	type Baris = {
		id: number;
		nama: string;
		role: string;
		operatorLevel?: string | null;
		username: string;
		bisaHapus: boolean;
		nik_username: string;
		kelas: string | null;
		mapel: string | null;
		izin: number;
		dibuat: string | null;
	};

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let searchTerm = $state(data.filter?.q ?? '');
	let terpilih = $state<number[]>([]);
	let hapusId = $state<number | null>(null);
	let tambahTerbuka = $state(false);
	let imporTerbuka = $state(false);
	let sandiImport = $state<'username' | 'tetap'>('username');
	let sandiTetap = $state('');
	let wajibGantiImport = $state(true);
	let perbaruiNamaImport = $state(false);
	let namaFileImport = $state('');
	let submittingImpor = $state(false);
	let roleBaru = $state<'user' | 'wali_kelas' | 'admin' | 'kepala_sekolah'>('user');
	let kelasBaru = $state('');
	let mapelBaru = $state('');

	const kelompokKey = $derived(String(data.kelompok?.key ?? 'guru'));
	const roleOpsi = $derived(
		kelompokKey === 'operator'
			? ([
					{ value: 'admin', label: 'Admin' },
					{ value: 'kepala_sekolah', label: 'Kepala Sekolah' }
				] as Array<{ value: string; label: string }>)
			: ([
					{ value: 'user', label: 'Guru' },
					{ value: 'wali_kelas', label: 'Wali Kelas' }
				] as Array<{ value: string; label: string }>)
	);
	const baris = $derived((data.baris ?? []) as Baris[]);
	const daftarKelas = $derived(
		(data.daftarKelas ?? []) as Array<{ id: number; nama: string; fase: string | null }>
	);
	const daftarMapel = $derived(
		(data.daftarMapel ?? []) as Array<{ id: number; nama: string; kelasId: number }>
	);
	const mapelSesuaiKelas = $derived(
		kelasBaru ? daftarMapel.filter((m) => String(m.kelasId) === String(kelasBaru)) : daftarMapel
	);
	const total = $derived(data.total ?? 0);
	const totalHalaman = $derived(data.totalHalaman ?? 1);
	const perHalaman = $derived(data.perHalaman ?? 50);
	const halamanSekarang = $derived(data.filter?.page ?? 1);
	const nomorHalaman = $derived(buildPageNumbers(halamanSekarang, totalHalaman));
	const idsHalaman = $derived(baris.map((row) => row.id));

	const rekapRole = $derived.by(() => {
		const map = new Map<string, number>();
		for (const row of baris) map.set(row.role, (map.get(row.role) ?? 0) + 1);
		return [...map.entries()].sort((a, b) => b[1] - a[1]);
	});

	async function terapkanFilter(key: string, value: string) {
		await goto(setFilter(page.url, key, value), { replaceState: true, keepFocus: true });
	}

	async function gotoPage(pageNumber: number) {
		const params = new URLSearchParams(page.url.search);
		params.set('page', String(pageNumber));
		await goto(`${page.url.pathname}?${params.toString()}`, { keepFocus: true });
	}

	async function gotoPerHalaman(jumlah: number) {
		const params = new URLSearchParams(page.url.search);
		params.set('per_page', String(jumlah));
		params.delete('page');
		await goto(`${page.url.pathname}?${params.toString()}`, { keepFocus: true });
	}

	function formatTanggal(value: string | null | undefined): string {
		if (!value) return '—';
		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) return value;
		return new Intl.DateTimeFormat('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric'
		}).format(parsed);
	}

	async function handleSimpan({ data: hasil }: { data?: Record<string, unknown> }) {
		await invalidate('app:master-data');
		terpilih = [];
		hapusId = null;
		tambahTerbuka = false;
		imporTerbuka = false;
		namaFileImport = '';
		toast({
			message: typeof hasil?.message === 'string' ? hasil.message : 'Tersimpan',
			type: 'success'
		});
	}

	function tutupImpor() {
		sandiImport = 'username';
		sandiTetap = '';
		wajibGantiImport = true;
		perbaruiNamaImport = false;
		namaFileImport = '';
		imporTerbuka = false;
	}
</script>

<div class="card bg-base-100 rounded-lg border border-none p-4 shadow-md">
	<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0 flex-1">
			<h2 class="text-xl font-bold">Data Pengguna — {data.kelompok.judul}</h2>
			<p class="text-base-content/80 mt-1 block max-w-2xl text-sm">
				{data.kelompok.deskripsi}
			</p>
		</div>
		<div class="flex shrink-0 flex-wrap items-center gap-2">
			{#if terpilih.length}
				<FormEnhance action="?/hapusMassal" showToast={false} onsuccess={handleSimpan}>
					{#snippet children({ submitting })}
						<input type="hidden" name="ids" value={JSON.stringify(terpilih)} />
						<button type="submit" class="btn btn-error btn-soft shadow-none" disabled={submitting}>
							<Icon name="del" />
							Hapus {terpilih.length} Terpilih
						</button>
					{/snippet}
				</FormEnhance>
			{/if}
			{#if kelompokKey === 'guru'}
				<button
					type="button"
					class="btn btn-soft shadow-none"
					onclick={() => (imporTerbuka = true)}
				>
					<Icon name="import" />
					Impor Daftar Guru
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-primary btn-soft shadow-none"
				onclick={() => {
					roleBaru = kelompokKey === 'operator' ? 'admin' : 'user';
					kelasBaru = '';
					mapelBaru = '';
					tambahTerbuka = true;
				}}
			>
				<Icon name="plus" />
				Tambah Akun
			</button>
		</div>
	</div>

	<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
		<FilterToolbar
			bind:q={searchTerm}
			qPlaceholder="Cari nama, NIK, atau username..."
			onSearch={(value) => terapkanFilter('q', value)}
			pilih={[
				{
					name: 'role',
					label: 'Peran',
					value: String(data.filter?.role ?? ''),
					opsis: [{ value: '', label: 'Semua Peran' }, ...(data.opsiRole ?? [])],
					onChange: (v) => terapkanFilter('role', v)
				}
			]}
			aktif={countActiveFilters(page.url, KUNCI_FILTER)}
			onReset={() =>
				goto(resetFilters(page.url, KUNCI_FILTER), { replaceState: true, keepFocus: true })}
		>
			<select
				class="select bg-base-200 dark:bg-base-300 w-auto shrink dark:border-none"
				value={perHalaman}
				title="Baris per halaman"
				onchange={(event) =>
					gotoPerHalaman(Number((event.currentTarget as HTMLSelectElement).value))}
			>
				{#each OPSI_BARIS_PER_HALAMAN as jumlah (jumlah)}
					<option value={jumlah}>{jumlah} / hal</option>
				{/each}
			</select>
		</FilterToolbar>
		<div class="flex flex-wrap items-center gap-2">
			{#each rekapRole as [role, jumlah] (role)}
				<span class="badge badge-sm badge-soft badge-primary">{role} {jumlah}</span>
			{/each}
		</div>
	</div>

	<div class="bg-base-100 dark:bg-base-200 overflow-x-auto rounded-md shadow-md dark:shadow-none">
		<table class="border-base-200 table border dark:border-none">
			<thead>
				<tr class="bg-base-200 dark:bg-base-300 text-base-content text-left font-bold">
					<th style="width: 50px; min-width: 40px;" class="text-center">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							checked={semuaTerpilih(idsHalaman, terpilih)}
							onchange={(event) =>
								(terpilih = selectAll(
									idsHalaman,
									(event.currentTarget as HTMLInputElement).checked
								))}
						/>
					</th>
					<th style="min-width: 140px;">NIK / Username</th>
					<th style="min-width: 200px;">Nama</th>
					<th style="min-width: 110px;">Role</th>
					<th style="min-width: 110px;">Kelas</th>
					<th style="min-width: 130px;">Mata Pelajaran</th>
					<th class="text-center hidden xl:table-cell" style="width: 100px;">Hak Akses</th>
					<th class="hidden xl:table-cell" style="min-width: 110px;">Dibuat</th>
					<th class="text-center" style="width: 200px;">Aksi</th>
				</tr>
			</thead>
			<tbody>
				{#each baris as row (row.id)}
					<tr class={terpilih.includes(row.id) ? 'bg-base-200/40' : undefined}>
						<td class="text-center">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								checked={terpilih.includes(row.id)}
								disabled={!row.bisaHapus}
								onchange={(event) =>
									(terpilih = toggleId(
										terpilih,
										row.id,
										(event.currentTarget as HTMLInputElement).checked
									))}
							/>
						</td>
						<td class="whitespace-nowrap">{row.nik_username}</td>
						<td>
							<span class="font-medium">{row.nama}</span>
						</td>
						<td>
							<div class="flex flex-wrap items-center gap-1">
								<span class="badge badge-sm badge-soft badge-primary">{row.role}</span>
								{#if row.operatorLevel}
									<span class="badge badge-sm badge-soft badge-secondary">
										{row.operatorLevel === 'kepala_sekolah' ? 'Kepala Sekolah' : 'Admin'}
									</span>
								{/if}
							</div>
						</td>
						<td>{row.kelas ?? '—'}</td>
						<td>{row.mapel ?? '—'}</td>
						<td class="text-center hidden xl:table-cell">{row.izin}</td>
						<td class="hidden xl:table-cell whitespace-nowrap">
							{formatTanggal(row.dibuat)}
						</td>
						<td>
							<div class="flex items-center justify-center gap-1">
								{#if hapusId === row.id}
									<FormEnhance action="?/hapus" showToast={false} onsuccess={handleSimpan}>
										{#snippet children({ submitting })}
											<input type="hidden" name="id" value={row.id} />
											<div class="flex items-center justify-center gap-1">
												<button
													type="submit"
													class="btn btn-error btn-soft btn-sm shadow-none"
													disabled={submitting}
												>
													Ya
												</button>
												<button
													type="button"
													class="btn btn-soft btn-sm shadow-none"
													onclick={() => (hapusId = null)}
												>
													Batal
												</button>
											</div>
										{/snippet}
									</FormEnhance>
								{:else}
									<a
										class="btn btn-soft btn-sm shadow-none whitespace-nowrap"
										href={`/pengguna/${row.id}`}
									>
										<Icon name="eye" />
										Kelola
									</a>
									<a
										class="btn btn-soft btn-sm shadow-none whitespace-nowrap"
										href={`/pengguna/form/${row.id}`}
									>
										<Icon name="edit" />
										Ubah
									</a>
									<button
										type="button"
										class="btn btn-soft btn-error btn-sm shadow-none"
										title={row.bisaHapus ? 'Hapus akun' : 'Akun utama admin tidak bisa dihapus'}
										disabled={!row.bisaHapus}
										onclick={() => (hapusId = row.id)}
									>
										<Icon name="del" />
									</button>
								{/if}
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td class="p-6 text-center" colspan="9">
							<em class="opacity-60">
								{#if data.adaDataAwal}
									Tidak ada akun {data.kelompok.judul.toLowerCase()} yang cocok dengan filter saat ini.
								{:else}
									Belum ada akun {data.kelompok.judul.toLowerCase()}.
								{/if}
							</em>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if totalHalaman > 1}
		<div class="mt-4 flex justify-center">
			<div class="join">
				<button
					type="button"
					class="join-item btn"
					disabled={halamanSekarang <= 1}
					onclick={() => gotoPage(halamanSekarang - 1)}
				>
					«
				</button>
				{#each nomorHalaman as nomor, index (index)}
					{#if nomor === '…'}
						<button type="button" class="join-item btn" disabled>…</button>
					{:else}
						<button
							type="button"
							class="join-item btn"
							class:btn-active={nomor === halamanSekarang}
							onclick={() => gotoPage(nomor)}
						>
							{nomor}
						</button>
					{/if}
				{/each}
				<button
					type="button"
					class="join-item btn"
					disabled={halamanSekarang >= totalHalaman}
					onclick={() => gotoPage(halamanSekarang + 1)}
				>
					»
				</button>
			</div>
		</div>
	{/if}

	<p class="mt-3 text-center text-sm opacity-70">
		Menampilkan {baris.length} dari {total} akun
	</p>
</div>

{#if imporTerbuka}
	<dialog class="modal" open onclose={tutupImpor}>
		<div class="modal-box flex max-h-[85vh] flex-col p-4 sm:max-w-2xl">
			<h3 class="mb-2 shrink-0 text-lg font-bold">Impor Daftar Guru</h3>

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
				<p class="text-base-content/70 text-sm">
					Unggah file Excel (.xlsx) atau CSV dengan kolom <strong>Pengguna/Password</strong> dan
					<strong>Nama</strong>. Akun yang sudah ada akan dilewati.
				</p>

				<div class="overflow-auto rounded-lg text-sm">
					<table class="table-sm table-compact table-zebra table w-full border-collapse">
						<thead class="bg-base-300">
							<tr class="text-sm font-semibold">
								<th class="pl-2">Pengguna/Password</th>
								<th>Nama</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td class="pl-2 font-medium">201207002</td>
								<td>Asmin Mulyana, S.Kom., M.M.</td>
							</tr>
							<tr>
								<td class="pl-2 font-medium">201207003</td>
								<td>Oos Bukhori, S.Pd., M.M.</td>
							</tr>
						</tbody>
					</table>
				</div>

				<FormEnhance
					id="form-impor-guru"
					action="?/imporGuru"
					enctype="multipart/form-data"
					showToast={false}
					onsuccess={handleSimpan}
					submitStateChange={(submitting) => (submittingImpor = submitting)}
				>
					{#snippet children({ submitting })}
						<fieldset class="fieldset">
							<legend class="fieldset-legend font-semibold">Pilih file daftar guru</legend>
							<input
								id="impor-guru-file"
								name="file"
								type="file"
								accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
								class="file-input file-input-ghost w-full"
								required
								disabled={submitting}
								onchange={(event) =>
									(namaFileImport =
										(event.currentTarget as HTMLInputElement).files?.[0]?.name ?? '')}
							/>
							<label class="label" for="impor-guru-file">
								<span class="label-text-alt text-base-content/60 text-xs text-wrap">
									Maksimal 2 MB. Pastikan kolom <strong>Pengguna/Password</strong> dan
									<strong>Nama</strong> tersedia.
									{#if namaFileImport}
										<span class="text-base-content">Dipilih: <strong>{namaFileImport}</strong></span
										>
									{/if}
								</span>
							</label>
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend font-semibold">Kata sandi awal</legend>
							<select
								name="sandi"
								class="select bg-base-200 dark:bg-base-300 w-full dark:border-none"
								disabled={submitting}
								onchange={(event) =>
									(sandiImport = event.currentTarget.value as 'username' | 'tetap')}
							>
								<option value="username" selected={sandiImport === 'username'}>
									Sama dengan username
								</option>
								<option value="tetap" selected={sandiImport === 'tetap'}>Sama untuk semua</option>
							</select>
							{#if sandiImport === 'tetap'}
								<input
									name="sandi_tetap"
									type="text"
									class="input bg-base-200 dark:bg-base-300 mt-2 w-full dark:border-none"
									bind:value={sandiTetap}
									placeholder="Kata sandi bersama, minimal 8 karakter"
									disabled={submitting}
								/>
							{/if}
						</fieldset>

						<fieldset class="fieldset">
							<legend class="fieldset-legend font-semibold">Opsi lainnya</legend>
							<label class="label cursor-pointer justify-start gap-2 py-1">
								<input
									type="checkbox"
									name="wajib_ganti"
									class="checkbox checkbox-sm"
									value="ya"
									checked={wajibGantiImport}
									disabled={submitting}
									onchange={(event) =>
										(wajibGantiImport = (event.currentTarget as HTMLInputElement).checked)}
								/>
								<span class="text-sm">Wajib ganti kata sandi saat login pertama</span>
							</label>
							<label class="label cursor-pointer justify-start gap-2 py-1">
								<input
									type="checkbox"
									name="perbarui_nama"
									class="checkbox checkbox-sm"
									value="ya"
									checked={perbaruiNamaImport}
									disabled={submitting}
									onchange={(event) =>
										(perbaruiNamaImport = (event.currentTarget as HTMLInputElement).checked)}
								/>
								<span class="text-sm">Perbarui nama akun yang sudah ada</span>
							</label>
						</fieldset>
					{/snippet}
				</FormEnhance>
			</div>

			<div class="modal-action sticky bottom-0 z-10 shrink-0 pt-2">
				<button
					type="button"
					class="btn btn-soft shadow-none mr-auto"
					onclick={tutupImpor}
					disabled={submittingImpor}>Batal</button
				>
				<button
					type="submit"
					form="form-impor-guru"
					class="btn btn-primary btn-soft shadow-none"
					disabled={submittingImpor || !namaFileImport}
				>
					{#if submittingImpor}
						<span class="loading loading-spinner"></span>
					{:else}
						<Icon name="import" /> Impor
					{/if}
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop">
			<button>Batal</button>
		</form>
	</dialog>
{/if}

{#if tambahTerbuka}
	<dialog class="modal" open>
		<div class="modal-box max-w-2xl">
			<h3 class="mb-4 text-lg font-bold">Tambah Akun {data.kelompok.judul}</h3>

			<FormEnhance action="?/tambah" showToast={false} onsuccess={handleSimpan}>
				{#snippet children({ submitting, invalid })}
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="form-control sm:col-span-2">
							<span class="label-text mb-1 text-sm">
								Nama Lengkap <span class="text-error">*</span>
							</span>
							<input
								name="nama"
								type="text"
								class="input input-bordered w-full rounded-xl"
								placeholder="Nama lengkap pengguna"
								required
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">NIK (opsional)</span>
							<input
								name="nik"
								type="text"
								inputmode="numeric"
								maxlength="16"
								class="input input-bordered w-full rounded-xl"
								placeholder="16 digit NIK"
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">Role</span>
							<select
								name="type"
								class="select select-bordered w-full rounded-xl"
								disabled={submitting}
								onchange={(event) => (roleBaru = event.currentTarget.value as typeof roleBaru)}
							>
								{#each roleOpsi as opsi (opsi.value)}
									<option value={opsi.value} selected={roleBaru === opsi.value}>
										{opsi.label}
									</option>
								{/each}
							</select>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">
								Nama Pengguna <span class="text-error">*</span>
							</span>
							<input
								name="username"
								type="text"
								class="input input-bordered w-full rounded-xl"
								placeholder="Username untuk login"
								required
								disabled={submitting}
							/>
						</label>
						<label class="form-control">
							<span class="label-text mb-1 text-sm">
								Kata Sandi <span class="text-error">*</span>
							</span>
							<input
								name="password"
								type="password"
								class="input input-bordered w-full rounded-xl"
								placeholder="Minimal 8 karakter"
								required
								disabled={submitting}
							/>
						</label>
						{#if kelompokKey === 'guru'}
							<label class="form-control">
								<span class="label-text mb-1 text-sm">Kelas</span>
								<select
									name="kelas_id"
									class="select select-bordered w-full rounded-xl"
									disabled={submitting}
									onchange={(event) => {
										kelasBaru = event.currentTarget.value;
										mapelBaru = '';
									}}
								>
									<option value="">—</option>
									{#each daftarKelas as kelas (kelas.id)}
										<option value={kelas.id} selected={kelasBaru === String(kelas.id)}>
											{kelas.fase ? `${kelas.nama} - ${kelas.fase}` : kelas.nama}
										</option>
									{/each}
								</select>
							</label>
							<label class="form-control">
								<span class="label-text mb-1 text-sm">Mata Pelajaran</span>
								<select
									name="mata_pelajaran_id"
									class="select select-bordered w-full rounded-xl"
									disabled={submitting}
									onchange={(event) => (mapelBaru = event.currentTarget.value)}
								>
									<option value="">—</option>
									{#each mapelSesuaiKelas as mapel (mapel.id)}
										<option value={mapel.id} selected={mapelBaru === String(mapel.id)}>
											{mapel.nama}
										</option>
									{/each}
								</select>
							</label>
							<label class="form-control sm:col-span-2">
								<span class="label-text mb-1 text-sm">Level Operator (opsional)</span>
								<select
									name="operator_level"
									class="select select-bordered w-full rounded-xl"
									disabled={submitting}
								>
									<option value="">—</option>
									<option value="admin">Admin (akses operator penuh)</option>
									<option value="kepala_sekolah">Kepala Sekolah (tanpa fitur global)</option>
								</select>
								<span class="label-text-alt text-base-content/60 mt-1 text-xs">
									Beri akses operator kepada guru tanpa mengubah peran utamanya.
								</span>
							</label>
						{/if}
					</div>

					<div class="modal-action">
						<button
							type="button"
							class="btn btn-ghost rounded-xl"
							onclick={() => (tambahTerbuka = false)}
							disabled={submitting}
						>
							<Icon name="close" />
							Batal
						</button>
						<button
							type="submit"
							class="btn btn-primary btn-soft rounded-xl shadow-none"
							disabled={submitting || invalid}
						>
							{#if submitting}
								<span class="loading loading-spinner loading-sm"></span>
							{:else}
								<Icon name="save" />
							{/if}
							Simpan Akun
						</button>
					</div>
				{/snippet}
			</FormEnhance>
		</div>
		<div class="modal-backdrop">
			<button type="button" onclick={() => (tambahTerbuka = false)}>close</button>
		</div>
	</dialog>
{/if}
