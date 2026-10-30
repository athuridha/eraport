<script lang="ts">
	import { goto } from '$app/navigation';
	import FormEnhance from '$lib/components/form-enhance.svelte';
	import Icon from '$lib/components/icon.svelte';
	import {
		defaultPermissionsByType,
		groupedUserPermissions,
		userPermissions
	} from '../../permissions';

	let { data } = $props();

	const isEditMode = $derived(!!data.userDetail);
	const guruName = $derived(data.userDetail?.pegawaiName?.trim() ?? '');
	const pageTitle = $derived(
		isEditMode ? `Edit Pengguna${guruName ? `: ${guruName}` : ''}` : 'Tambah Pengguna'
	);
	const pageDesc = $derived(
		isEditMode
			? 'Perbarui informasi pengguna dan hak akses.'
			: 'Buat akun pengguna baru dan tentukan hak aksesnya.'
	);

	/** Pilihan role boleh dikombinasi; server mengarahkan ke `type` + `operatorLevel`. */
	const ROLE_OPTIONS = [
		{
			value: 'guru',
			label: 'Guru',
			desc: 'Mengajar mata pelajaran pilihan, input nilai & presensi.'
		},
		{
			value: 'wali_kelas',
			label: 'Wali Kelas',
			desc: 'Kelola satu kelas penuh: semua mapel, catatan, rapor.'
		},
		{
			value: 'operator',
			label: 'Operator',
			desc: 'Mengelola data master, presensi guru, dan administrasi sekolah.'
		},
		{
			value: 'kepala_sekolah',
			label: 'Kepala Sekolah',
			desc: 'Akses manajerial: monitor semua kelas & kepegawaian.'
		},
		{
			value: 'admin',
			label: 'Admin',
			desc: 'Akses mutlak seluruh aplikasi, termasuk pengaturan sistem.'
		}
	] as const;

	// svelte-ignore state_referenced_locally
	let nama = $state(data.userDetail?.pegawaiName ?? '');
	// svelte-ignore state_referenced_locally
	let nik = $state(data.userDetail?.pegawaiNik ?? '');
	// svelte-ignore state_referenced_locally
	let username = $state(data.userDetail?.username ?? '');
	let password = $state('');
	// svelte-ignore state_referenced_locally
	let roles = $state<string[]>(data.userDetail?.roles ?? ['guru']);
	// svelte-ignore state_referenced_locally
	let sekolahId = $state<string | number | null>(data.userDetail?.sekolahId ?? '');
	// svelte-ignore state_referenced_locally
	let mataPelajaranIds = $state(new Set<number>(data.userDetail?.mataPelajaranIds ?? []));
	// svelte-ignore state_referenced_locally
	let kelasIds = $state(new Set<number>(data.userDetail?.kelasIds ?? []));
	let showPassword = $state(false);

	// Akun existing memakai izin yang tersimpan; akun baru mulai dari template role.
	// svelte-ignore state_referenced_locally
	let permissions = $state(
		new Set<string>(
			data.userDetail?.permissions ??
				defaultPermissionsByType[(data.userDetail?.type ?? 'user') as AuthUser['type']] ??
				[]
		)
	);

	const rolesSet = $derived(new Set(roles));
	const hasEducator = $derived(rolesSet.has('guru') || rolesSet.has('wali_kelas'));
	// Admin & kepala sekolah murni selalu memegang seluruh izin.
	const isAdminRole = $derived(
		rolesSet.has('admin') || (rolesSet.has('kepala_sekolah') && !hasEducator)
	);
	const adminRoleLabel = $derived(rolesSet.has('admin') ? 'Admin' : 'Kepala Sekolah');
	const multiKelas = $derived(kelasIds.size > 1);

	// Izin yang benar-benar dikirim: kelas_pindah menyusul otomatis untuk akun
	// dengan lebih dari satu kelas, admin memakai daftar penuh.
	const effectivePermissions = $derived.by(() => {
		if (isAdminRole) return new Set<string>(userPermissions);
		const set = new Set(permissions);
		if (multiKelas && hasEducator) set.add('kelas_pindah');
		return set;
	});

	/** Gabungkan izin default dari semua role yang dicentang. */
	function applyRoleTemplates() {
		const templateKeys: string[] = [];
		if (rolesSet.has('admin')) templateKeys.push('admin');
		if (rolesSet.has('kepala_sekolah')) templateKeys.push('kepala_sekolah');
		if (rolesSet.has('operator')) templateKeys.push('admin');
		if (rolesSet.has('wali_kelas')) templateKeys.push('wali_kelas');
		if (rolesSet.has('guru')) templateKeys.push('user');
		const merged = new Set<string>();
		for (const key of templateKeys) {
			for (const permission of defaultPermissionsByType[key as AuthUser['type']] ?? []) {
				merged.add(permission);
			}
		}
		permissions = merged;
		if (isAdminRole) {
			mataPelajaranIds = new Set<number>();
			kelasIds = new Set<number>();
		}
	}

	function clearMapel() {
		mataPelajaranIds = new Set<number>();
	}

	function clearKelas() {
		kelasIds = new Set<number>();
	}

	function togglePermission(key: string) {
		const next = new Set(permissions);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		permissions = next;
	}

	const isFormValid = $derived.by(() => {
		const hasNama = nama.trim().length > 0;
		const hasUsername = username.trim().length > 0;
		const hasPassword = isEditMode ? true : password.trim().length > 0;
		return hasNama && hasUsername && hasPassword;
	});

	function uniqueByNama(list: { id: number; nama: string }[]) {
		const map = new Map<string, { id: number; nama: string }>();
		for (const m of list) {
			if (!map.has(m.nama)) map.set(m.nama, m);
		}
		return Array.from(map.values());
	}

	let uniqueMataPelajaran = $derived(uniqueByNama(data.mataPelajaran ?? []));
	let filteredMataPelajaran = $derived(
		uniqueMataPelajaran.filter((m) => {
			const name = (m.nama ?? '').toString().trim().toLowerCase();
			if (name === 'pendidikan agama dan budi pekerti') return false;
			if (name === 'pendalaman kitab suci') return false;
			return true;
		})
	);

	let searchMapel = $state('');
	let searchedMataPelajaran = $derived.by(() => {
		const q = searchMapel.trim().toLowerCase();
		if (!q) return filteredMataPelajaran;
		return filteredMataPelajaran.filter((m) => (m.nama ?? '').toLowerCase().includes(q));
	});

	let someSearchedMapelSelected = $derived(
		searchedMataPelajaran.length > 0 &&
			searchedMataPelajaran.some((m) => mataPelajaranIds.has(m.id))
	);
	let allSearchedMapelSelected = $derived(
		searchedMataPelajaran.length > 0 &&
			searchedMataPelajaran.every((m) => mataPelajaranIds.has(m.id))
	);

	function toggleSelectAllSearchedMapel() {
		if (allSearchedMapelSelected) {
			for (const m of searchedMataPelajaran) mataPelajaranIds.delete(m.id);
		} else {
			for (const m of searchedMataPelajaran) mataPelajaranIds.add(m.id);
		}
		mataPelajaranIds = new Set(mataPelajaranIds);
	}

	let filteredKelasList = $derived.by(() => {
		if (!sekolahId) return data.kelasList ?? [];
		const sId = Number(sekolahId);
		return (data.kelasList ?? []).filter((k: { sekolahId?: number | null }) => k.sekolahId === sId);
	});

	let searchKelas = $state('');
	let searchedKelasList = $derived.by(() => {
		const q = searchKelas.trim().toLowerCase();
		if (!q) return filteredKelasList;
		return filteredKelasList.filter((k) => {
			const namaMatch = (k.nama ?? '').toLowerCase().includes(q);
			const faseMatch = (k.fase ?? '').toLowerCase().includes(q);
			return namaMatch || faseMatch;
		});
	});

	let someSearchedKelasSelected = $derived(
		searchedKelasList.length > 0 && searchedKelasList.some((k) => kelasIds.has(k.id))
	);
	let allSearchedKelasSelected = $derived(
		searchedKelasList.length > 0 && searchedKelasList.every((k) => kelasIds.has(k.id))
	);

	function toggleSelectAllSearchedKelas() {
		if (allSearchedKelasSelected) {
			for (const k of searchedKelasList) kelasIds.delete(k.id);
		} else {
			for (const k of searchedKelasList) kelasIds.add(k.id);
		}
		kelasIds = new Set(kelasIds);
	}

	const visibleKelasCount = $derived(filteredKelasList.filter((k) => kelasIds.has(k.id)).length);

	const waliKelasIdSet = $derived(new Set(data.userDetail?.waliKelasIds ?? []));
	const roleHint = $derived.by(() => {
		if (!isEditMode || !rolesSet.has('wali_kelas')) return '';
		const list = (data.kelasList ?? []) as {
			id: number;
			nama: string;
			fase?: string | null;
			sekolahId: number;
		}[];
		const waliNames = list.filter((k) => waliKelasIdSet.has(k.id)).map((k) => k.nama);
		const guruNames = list
			.filter((k) => !waliKelasIdSet.has(k.id) && kelasIds.has(k.id))
			.map((k) => k.nama);
		const parts: string[] = [];
		if (waliNames.length) parts.push(`Wali Kelas ${waliNames.join(', ')}`);
		if (guruNames.length) parts.push(`Guru di ${guruNames.join(', ')}`);
		return parts.join(' · ');
	});

	function toggleMapel(id: number) {
		if (mataPelajaranIds.has(id)) {
			mataPelajaranIds.delete(id);
		} else {
			mataPelajaranIds.add(id);
		}
		mataPelajaranIds = new Set(mataPelajaranIds);
	}

	function toggleKelas(id: number) {
		if (kelasIds.has(id)) {
			kelasIds.delete(id);
		} else {
			kelasIds.add(id);
		}
		kelasIds = new Set(kelasIds);
	}
</script>

<section class="card bg-base-100 mx-auto w-full rounded-lg border border-none p-6 shadow-md">
	<header class="mb-6">
		<div>
			<h1 class="text-2xl font-bold">{pageTitle}</h1>
			<p class="text-base-content/70 mt-1 text-sm">{pageDesc}</p>
		</div>
	</header>

	<FormEnhance action="?/save" onsuccess={() => goto('/pengguna')}>
		{#snippet children({ submitting })}
			<div class="space-y-4">
				<!-- Sekolah -->
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Sekolah</legend>
					<select
						id="form-sekolah"
						class="select bg-base-200 dark:bg-base-300 w-full truncate dark:border-none"
						name="sekolahId"
						bind:value={sekolahId}
						onchange={() => {
							kelasIds = new Set<number>();
						}}
					>
						<option disabled selected={sekolahId === ''} value="">Pilih Sekolah</option>
						{#if data.sekolahList && data.sekolahList.length}
							{#each data.sekolahList as s (s.id)}
								<option value={s.id}>{s.nama}</option>
							{/each}
						{:else}
							<option disabled>- tidak ada sekolah -</option>
						{/if}
					</select>
					<p class="label text-wrap">
						Opsional: kaitkan pengguna ke sekolah tertentu sehingga saat login sekolah aktif bisa
						disesuaikan.
					</p>
				</fieldset>

				<!-- Mata Pelajaran Collapse -->
				<details class="bg-base-200 border-base-300 collapse-arrow collapse">
					<summary class="collapse-title font-semibold">
						Mata Pelajaran
						{#if isAdminRole}
							<span class="badge badge-sm badge-ghost text-xs ml-1"
								>Opsional untuk {adminRoleLabel}</span
							>
						{/if}
						{#if mataPelajaranIds.size > 0}
							<span class="badge badge-sm badge-primary ml-1">{mataPelajaranIds.size}</span>
						{/if}
					</summary>
					<div class="collapse-content text-sm">
						<div class="space-y-3 pt-1">
							{#if isAdminRole}
								<div
									class="alert alert-info bg-info/10 text-info-content border-info/20 text-xs py-2"
								>
									<Icon name="info" class="w-4 h-4 shrink-0 text-info" />
									<span>
										Role <strong>{adminRoleLabel}</strong> memiliki akses manajerial penuh ke seluruh
										mata pelajaran. Bagian ini tidak perlu diisi.
									</span>
								</div>
							{:else}
								<p class="text-xs opacity-75">
									Pilih satu atau lebih mata pelajaran yang diajari. Khusus role "Wali Kelas" skip
									langkah ini, karena bawaan Wali Kelas sudah punya akses ke semua mata pelajaran.
								</p>
							{/if}

							{#if filteredMataPelajaran.length > 0}
								<!-- Toolbar Pencarian & Aksi -->
								<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div class="relative flex-1">
										<Icon
											name="search"
											class="text-base-content/50 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
										/>
										<input
											type="text"
											placeholder="Cari mata pelajaran..."
											bind:value={searchMapel}
											onkeydown={(e) => {
												if (e.key === 'Enter') e.preventDefault();
											}}
											class="input input-sm bg-base-100 border-base-300 w-full rounded-lg pl-9 pr-8"
										/>
										{#if searchMapel}
											<button
												type="button"
												class="btn btn-ghost btn-xs btn-circle absolute right-1.5 top-1/2 -translate-y-1/2"
												onclick={() => (searchMapel = '')}
												aria-label="Bersihkan pencarian"
											>
												<Icon name="close" class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
									{#if mataPelajaranIds.size > 0}
										<button
											type="button"
											class="btn btn-xs btn-outline btn-error shadow-none shrink-0"
											onclick={clearMapel}
										>
											Kosongkan pilihan ({mataPelajaranIds.size})
										</button>
									{/if}
								</div>

								<!-- Tabel Mata Pelajaran -->
								<div
									class="max-h-72 overflow-x-auto overflow-y-auto rounded-lg border border-base-300 bg-base-100"
								>
									<table class="table table-sm w-full">
										<thead class="sticky top-0 z-10 bg-base-200">
											<tr>
												<th class="w-12 text-center">
													<input
														type="checkbox"
														class="checkbox checkbox-xs"
														checked={allSearchedMapelSelected}
														indeterminate={someSearchedMapelSelected && !allSearchedMapelSelected}
														onchange={toggleSelectAllSearchedMapel}
														disabled={searchedMataPelajaran.length === 0}
														title="Pilih semua yang tampil"
														aria-label="Pilih semua mata pelajaran yang tampil"
													/>
												</th>
												<th>Mata Pelajaran</th>
												<th class="w-24 text-center">Status</th>
											</tr>
										</thead>
										<tbody>
											{#if searchedMataPelajaran.length === 0}
												<tr>
													<td colspan="3" class="text-center py-6 text-base-content/60 text-xs">
														Tidak ada data yang cocok dengan pencarian.
													</td>
												</tr>
											{:else}
												{#each searchedMataPelajaran as m (m.id)}
													{@const selected = mataPelajaranIds.has(m.id)}
													<tr
														class="cursor-pointer transition-colors hover:bg-base-200/60 {selected
															? 'bg-primary/10'
															: ''}"
														onclick={() => toggleMapel(m.id)}
													>
														<td class="text-center">
															<input
																type="checkbox"
																class="checkbox checkbox-xs checkbox-primary"
																checked={selected}
																onclick={(e) => e.stopPropagation()}
																onchange={() => toggleMapel(m.id)}
																aria-label={`Pilih ${m.nama}`}
															/>
														</td>
														<td class="font-medium text-sm">
															{m.nama}
														</td>
														<td class="text-center">
															{#if selected}
																<span class="badge badge-xs badge-primary font-medium"
																	>Terpilih</span
																>
															{:else}
																<span class="text-xs opacity-40">-</span>
															{/if}
														</td>
													</tr>
												{/each}
											{/if}
										</tbody>
									</table>
								</div>

								<div class="flex items-center justify-between text-xs text-base-content/60 px-1">
									<span>
										Menampilkan {searchedMataPelajaran.length} dari {filteredMataPelajaran.length} mata
										pelajaran
									</span>
									{#if mataPelajaranIds.size > 0}
										<span class="font-medium text-primary">
											{mataPelajaranIds.size} dipilih
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs opacity-75">- tidak ada mata pelajaran -</p>
							{/if}
						</div>
					</div>
				</details>

				<!-- Kelas Collapse -->
				<details class="bg-base-200 border-base-300 collapse-arrow collapse">
					<summary class="collapse-title font-semibold">
						Kelas
						{#if isAdminRole}
							<span class="badge badge-sm badge-ghost text-xs ml-1"
								>Opsional untuk {adminRoleLabel}</span
							>
						{/if}
						{#if visibleKelasCount > 0}
							<span class="badge badge-sm badge-secondary ml-1">{visibleKelasCount}</span>
						{/if}
					</summary>
					<div class="collapse-content text-sm">
						<div class="space-y-3 pt-1">
							{#if isAdminRole}
								<div
									class="alert alert-info bg-info/10 text-info-content border-info/20 text-xs py-2"
								>
									<Icon name="info" class="w-4 h-4 shrink-0 text-info" />
									<span>
										Role <strong>{adminRoleLabel}</strong> memiliki akses ke semua kelas. Bagian ini tidak
										perlu dipilih jika tidak merangkap wali kelas.
									</span>
								</div>
							{:else}
								<p class="text-xs opacity-75">Pilih satu atau lebih kelas yang bisa diakses</p>
							{/if}

							{#if filteredKelasList.length > 0}
								<!-- Toolbar Pencarian & Aksi -->
								<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
									<div class="relative flex-1">
										<Icon
											name="search"
											class="text-base-content/50 pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
										/>
										<input
											type="text"
											placeholder="Cari kelas atau fase..."
											bind:value={searchKelas}
											onkeydown={(e) => {
												if (e.key === 'Enter') e.preventDefault();
											}}
											class="input input-sm bg-base-100 border-base-300 w-full rounded-lg pl-9 pr-8"
										/>
										{#if searchKelas}
											<button
												type="button"
												class="btn btn-ghost btn-xs btn-circle absolute right-1.5 top-1/2 -translate-y-1/2"
												onclick={() => (searchKelas = '')}
												aria-label="Bersihkan pencarian"
											>
												<Icon name="close" class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
									{#if visibleKelasCount > 0}
										<button
											type="button"
											class="btn btn-xs btn-outline btn-error shadow-none shrink-0"
											onclick={clearKelas}
										>
											Kosongkan pilihan ({visibleKelasCount})
										</button>
									{/if}
								</div>

								<!-- Tabel Kelas -->
								<div
									class="max-h-72 overflow-x-auto overflow-y-auto rounded-lg border border-base-300 bg-base-100"
								>
									<table class="table table-sm w-full">
										<thead class="sticky top-0 z-10 bg-base-200">
											<tr>
												<th class="w-12 text-center">
													<input
														type="checkbox"
														class="checkbox checkbox-xs"
														checked={allSearchedKelasSelected}
														indeterminate={someSearchedKelasSelected && !allSearchedKelasSelected}
														onchange={toggleSelectAllSearchedKelas}
														disabled={searchedKelasList.length === 0}
														title="Pilih semua yang tampil"
														aria-label="Pilih semua kelas yang tampil"
													/>
												</th>
												<th>Kelas</th>
												<th class="w-20 text-center">Fase</th>
												<th class="w-32 text-center">Keterangan</th>
											</tr>
										</thead>
										<tbody>
											{#if searchedKelasList.length === 0}
												<tr>
													<td colspan="4" class="text-center py-6 text-base-content/60 text-xs">
														Tidak ada data yang cocok dengan pencarian.
													</td>
												</tr>
											{:else}
												{#each searchedKelasList as k (k.id)}
													{@const selected = kelasIds.has(k.id)}
													{@const isWali = waliKelasIdSet.has(k.id)}
													<tr
														class="cursor-pointer transition-colors hover:bg-base-200/60 {selected
															? 'bg-secondary/10'
															: ''}"
														onclick={() => toggleKelas(k.id)}
													>
														<td class="text-center">
															<input
																type="checkbox"
																class="checkbox checkbox-xs checkbox-secondary"
																checked={selected}
																onclick={(e) => e.stopPropagation()}
																onchange={() => toggleKelas(k.id)}
																aria-label={`Pilih ${k.nama}`}
															/>
														</td>
														<td class="font-medium text-sm">
															{k.nama}
														</td>
														<td class="text-center text-xs">
															{#if k.fase}
																<span class="badge badge-xs badge-ghost font-mono">{k.fase}</span>
															{:else}
																<span class="opacity-40">-</span>
															{/if}
														</td>
														<td class="text-center">
															<div class="flex items-center justify-center gap-1 flex-wrap">
																{#if isWali}
																	<span class="badge badge-xs badge-primary font-medium">Wali</span>
																{/if}
																{#if selected}
																	<span class="badge badge-xs badge-secondary font-medium"
																		>Terpilih</span
																	>
																{/if}
																{#if !isWali && !selected}
																	<span class="text-xs opacity-40">-</span>
																{/if}
															</div>
														</td>
													</tr>
												{/each}
											{/if}
										</tbody>
									</table>
								</div>

								<div class="flex items-center justify-between text-xs text-base-content/60 px-1">
									<span>
										Menampilkan {searchedKelasList.length} dari {filteredKelasList.length} kelas
									</span>
									{#if visibleKelasCount > 0}
										<span class="font-medium text-secondary">
											{visibleKelasCount} dipilih
										</span>
									{/if}
								</div>
							{:else}
								<p class="text-xs opacity-75">- tidak ada kelas -</p>
							{/if}
						</div>
					</div>
				</details>

				<!-- Nama + Role -->
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<fieldset class="fieldset">
						<legend class="fieldset-legend">Nama</legend>
						<input
							id="form-nama"
							required
							class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
							name="nama"
							bind:value={nama}
							placeholder="Contoh: Bruce Wayne, Bat."
						/>
						<p class="label text-wrap">Nama lengkap pengguna dan gelar</p>
					</fieldset>

					<!-- Role (checkbox, boleh dikombinasi) -->
					<fieldset class="fieldset sm:col-span-2">
						<legend class="fieldset-legend">Role</legend>
						<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
							{#each ROLE_OPTIONS as role (role.value)}
								<label
									class="bg-base-200 dark:bg-base-300 flex cursor-pointer items-start gap-2 rounded-lg p-2.5"
								>
									<input
										type="checkbox"
										class="checkbox checkbox-primary checkbox-sm mt-0.5"
										name="roles"
										bind:group={roles}
										value={role.value}
										onchange={applyRoleTemplates}
									/>
									<span>
										<span class="text-sm font-semibold">{role.label}</span>
										<span class="block text-xs opacity-70">{role.desc}</span>
									</span>
								</label>
							{/each}
						</div>
						<p class="label text-wrap">
							Centang lebih dari satu untuk akun peran ganda (contoh: operator yang juga guru atau
							wali kelas).
						</p>
						{#if roleHint}
							<p class="label text-wrap font-medium text-info">{roleHint}</p>
						{/if}
					</fieldset>
				</div>

				<!-- NIK -->
				<fieldset class="fieldset">
					<legend class="fieldset-legend">NIK Guru</legend>
					<input
						id="form-nik"
						type="text"
						inputmode="numeric"
						maxlength="16"
						class="input bg-base-200 dark:bg-base-300 w-full dark:border-none"
						name="nik"
						bind:value={nik}
						placeholder="16 digit NIK"
					/>
					<p class="label text-wrap">
						Dipakai guru untuk masuk ke e-Rapor. Kosongkan jika akun ini hanya memakai nama pengguna
						(mis. admin).
					</p>
				</fieldset>

				<!-- Akun -->
				<fieldset class="fieldset">
					<legend class="fieldset-legend">Akun</legend>
					<div class="flex flex-col gap-2 sm:flex-row">
						<label class="input validator bg-base-200 dark:bg-base-300 w-full dark:border-none">
							<Icon name="user" />
							<input
								id="form-username"
								type="text"
								required
								placeholder="Nama pengguna"
								title="Hanya huruf, angka, atau tanda hubung"
								name="username"
								bind:value={username}
							/>
						</label>
						<label class="input validator bg-base-200 dark:bg-base-300 w-full dark:border-none">
							<Icon name="lock" />
							<input
								id="form-password"
								type={showPassword ? 'text' : 'password'}
								name="password"
								placeholder={isEditMode
									? 'Kata sandi baru (kosongkan jika tidak diubah)'
									: 'Kata sandi'}
								bind:value={password}
							/>
							<button
								type="button"
								class="cursor-pointer"
								onclick={() => (showPassword = !showPassword)}
								aria-label="Lihat atau sembunyikan kata sandi"
							>
								<Icon name={showPassword ? 'eye-off' : 'eye'} />
							</button>
						</label>
					</div>
					<p class="validator-hint hidden">Isi nama pengguna dan kata sandi dulu!</p>
					<p class="label text-wrap">
						{isEditMode
							? 'Nama pengguna wajib diisi. Kata sandi opsional (kosongkan jika tidak diubah).'
							: 'Nama pengguna dan kata sandi untuk masuk'}
					</p>
				</fieldset>

				<!-- Hak Akses Collapse -->
				<details class="bg-base-200 border-base-300 collapse-arrow collapse">
					<summary class="collapse-title font-semibold">
						Hak Akses
						<span class="badge badge-sm badge-accent">{effectivePermissions.size}</span>
					</summary>
					<div class="collapse-content text-sm">
						<div class="space-y-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="text-xs opacity-75">
									Mengikuti template role di atas. Admin bisa menyalakan atau mematikan izin per
									akun.
								</p>
								<button
									type="button"
									class="btn btn-xs btn-soft shadow-none"
									disabled={isAdminRole || roles.length === 0}
									onclick={() => applyRoleTemplates()}
								>
									<Icon name="repeat" /> Sesuai template
								</button>
							</div>

							{#if isAdminRole}
								<p class="text-info text-xs">
									Admin dan Kepala Sekolah selalu memegang seluruh izin.
								</p>
							{/if}

							{#each Object.entries(groupedUserPermissions) as [group, permission] (group)}
								<div class="bg-base-300/60 rounded-lg p-2.5">
									<p class="mb-1.5 text-xs font-bold">{permission.description}</p>
									<div class="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
										{#each permission.values as [name, desc] (name)}
											{@const key = `${group}_${name}`}
											{@const autoPindah = key === 'kelas_pindah' && multiKelas}
											<label
												class="flex items-center justify-between gap-2 rounded px-2 py-1 {autoPindah
													? 'opacity-70'
													: 'hover:bg-base-200 cursor-pointer'}"
											>
												<span class="text-xs">
													{desc}
													{#if autoPindah}
														<span class="badge badge-xs badge-info ml-1">otomatis</span>
													{/if}
												</span>
												<input
													type="checkbox"
													class="toggle toggle-primary toggle-xs"
													checked={effectivePermissions.has(key)}
													disabled={isAdminRole || autoPindah}
													onchange={() => togglePermission(key)}
												/>
											</label>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					</div>
				</details>

				<!-- Hidden inputs for multi-select -->
				<input
					type="hidden"
					name="mataPelajaranIds"
					value={JSON.stringify(Array.from(mataPelajaranIds))}
				/>
				<input type="hidden" name="kelasIds" value={JSON.stringify(Array.from(kelasIds))} />
				<input
					type="hidden"
					name="permissions"
					value={JSON.stringify(Array.from(effectivePermissions))}
				/>
			</div>

			<div class="mt-6 flex items-center justify-between gap-2">
				<a href="/pengguna" class="btn btn-soft shadow-none"><Icon name="left" /> Kembali</a>
				<button
					class="btn btn-primary shadow-none"
					type="submit"
					disabled={!isFormValid || submitting}
					><Icon name="save" /> {submitting ? 'Menyimpan...' : 'Simpan'}</button
				>
			</div>
		{/snippet}
	</FormEnhance>
</section>
