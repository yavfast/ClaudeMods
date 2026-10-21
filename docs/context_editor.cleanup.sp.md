# Редактор контексту агента — Specification: Contracts: cleanup of old sessions

> **Code:** SP_CTX (дочірній файл набору)
> **Status:** active
> **Created:** 2026-10-13
> **Updated:** 2026-10-21
> **Umbrella:** [SP_CTX](./context_editor.sp.md)
>
> §02 Contracts 02_50–02_52 специфікації [SP_CTX](./context_editor.sp.md): видалення даних сесій, чий транскрипт хост уже видалив, пакування давно не відкритих сесій у `.zip` і відновлення запакованої сесії ([C_CTX_03_10](./context_editor.core.concept.md#C_CTX_03_10), [C_CTX_DEC_29](./context_editor.core.concept.md#C_CTX_DEC_29)). Читати перед зміною `hooks/cleanup.ts` або підготовки сховища.

## Contents

- [02_50. SweepSessions](#SP_CTX_02_50)
- [02_51. PackSession](#SP_CTX_02_51)
- [02_52. RestoreSession](#SP_CTX_02_52)

## 02. Contracts — старі сесії

Дані сесії — це її каталог сховища `<root>/<id>` (`<root>` = `$HOME/.claude/context-editor`) і її каталоги архівів `<archives>` у проєкті ([SP_CTX_01_07](./context_editor.structures.sp.md#SP_CTX_01_07)), по одному на кожен корінь проєкту сесії (`$.session.root()`; до фази 47 — на кожен робочий каталог), з якого сесію відкривали чи куди її переносили `/cd` або worktree. Шляхи каталогів архівів сховище пам'ятає у файлі `archives.txt` (по одному абсолютному шляху в рядку): ArchiveRoot дописує рядок, коли вперше створює каталог для цього кореня проєкту; сесія, чий корінь проєкту — `$HOME`, каталогу архівів не має (він збігся б зі сховищем), і її архіви лежать у сховищі. Запакована сесія — це `<root>/<id>.zip` замість `<root>/<id>` і `<archives>.zip` замість кожного `<archives>`; шляхи каталогів архівів лишаються в `archives.txt` усередині `<root>/<id>.zip`, а для пошуку без розпакування — ще й у `<root>/<id>.where` (ті самі рядки).

**Власний каталог архівів** (OwnArchives): мод пакує, розпаковує і видаляє каталог архівів сесії `id` лише тоді, коли його шлях абсолютний, не має сегментів `.` і `..`, закінчується на `/.claude/context-editor/<id>` і не є самим сховищем `<root>/<id>`. Будь-який інший рядок `archives.txt` чи `.where` пропускається.

### 02_50. SweepSessions  {#SP_CTX_02_50}

Purpose: раз на SWEEP_EVERY_MS прибрати дані сесій, які вже не відновити, і запакувати дані сесій, що давно не відкривались.

Processing logic (pseudocode):
    ON session.start (main session):                         # не з хука: відкладена дія $.clock.after(SWEEP_DELAY_MS)
        SCHEDULE Sweep(current = session_id)

    Sweep(current):
        IF <root>/.sweep exists AND now − its mtime < SWEEP_EVERY_MS: RETURN      # не частіше разу на добу на машину
        IF NOT mkdir <root>/.sweep.lock:                                            # атомарно: один прибиральник на машину
            IF now − mtime(<root>/.sweep.lock) < SWEEP_LOCK_MS: RETURN
            IF NOT rename <root>/.sweep.lock → <root>/.sweep.lock.stale-<унікальне>: RETURN   # завислий замок забирає лише один
            IF the renamed lock is fresh now: rename it back; RETURN          # його щойно взяв інший процес
            remove the renamed lock; IF NOT mkdir <root>/.sweep.lock: RETURN
        TRY:
            touch <root>/.sweep
            live = { name minus ".jsonl" : each <config>/projects/*/<name>.jsonl }   # <config> = $CLAUDE_CONFIG_DIR, інакше $HOME/.claude
            IF <config>/projects or any folder in it cannot be listed, OR live is empty: live = NONE   # тоді нічого не видаляється
            packer = Packer()                                                               # 02_51; NONE, коли інструмента немає
            done = 0
            FOR each entry e of <root> WITH name matching SESSION_ID (folder) or SESSION_ID + ".zip" (file), oldest mtime first:
                IF done ≥ SWEEP_MAX: BREAK
                id = e's session id
                IF id = current: CONTINUE
                idle = now − newest mtime of e (folder: of its files, one level down plus the folder itself; zip: its own)
                IF live ≠ NONE AND id ∉ live AND idle ≥ SWEEP_GRACE_MS:
                    Remove(id); done += 1                                           # транскрипту немає — сесію не відновити
                ELSE IF e is a folder AND packer ≠ NONE AND idle ≥ PACK_IDLE_MS:
                    IF PackSession(id, packer): done += 1
        FINALLY: remove <root>/.sweep.lock
    ON failure of any step: that entry stays as it is; the sweep goes on       # нічого не губиться: видаляється лише те, що вирішено

    Remove(id):
        archives = own lines (OwnArchives) of <root>/<id>/archives.txt and of <root>/<id>.where
        remove <root>/<id>, <root>/<id>.zip, <root>/<id>.where
        FOR a IN archives: remove a, a + ".zip"

Сесія без транскрипту і без власного каталогу архівів (до фази 35) видаляється разом з архівами всередині сховища. Каталог проєкту, якого вже немає, нічого не ламає: видалення відсутнього шляху — не помилка. Прибирання не чекає на хід і не залежить від нього; людина бачить один рядок налагодження (`$.ui.log` до `debug`): скільки сесій видалено й запаковано.

Errors:
| Condition | Result |
|-----------|--------|
| `$HOME` невідомий або `<root>` не читається | прибирання не йде |
| `<config>/projects` не читається або в ньому жодного транскрипту | лише пакування, жодного видалення |
| замок тримає інший процес (свіжий) | прибирання не йде |
| видалення або пакування сесії не вдалося | сесія як була; наступна |

### 02_51. PackSession  {#SP_CTX_02_51}

Purpose: замінити каталог сесії і її каталог архівів архівами `.zip`, не втративши жодного файлу.

Processing logic (pseudocode):
    Packer():                                       # один раз на процес модуля
        IF `zip -v` and `unzip -v` run: RETURN ZIP          # zip -qrX <zip> . (cwd = folder); unzip -tq <zip>; unzip -q[o|n] <zip> -d <folder>
        IF `tar --version` says "bsdtar": RETURN BSDTAR     # macOS, Windows 10+: tar --format zip -cf <zip> -C <folder> .; tar -tf <zip>; tar -x[k]f <zip> -C <folder>
        RETURN NONE                                          # GNU tar пише .tar під ім'ям .zip — не годиться

    PackSession(id, packer):
        archives = own lines of <root>/<id>/archives.txt and of <root>/<id>.where
        IF <root>/<id>.zip or any a + ".zip" exists: RETURN false       # .zip поруч із каталогом чекає злиття в RestoreSession, поверх нього не пакується
        FOR a IN archives: IF a exists AND is empty: remove a           # порожній каталог не пакується
        folders = (<root>/<id>) + (a IN archives that exist and are not empty)
        FOR f IN folders:
            remove f + ".zip.part"                                       # залишок обірваного пакування не доповнюється
            write f + ".zip.part" with packer; check it with packer      # повний вміст, перевірка цілісності
            IF either fails: remove every f + ".zip.part"; RETURN false  # каталоги не чіпаються
        IF folders has archives: write them to <root>/<id>.where, one per line
        FOR f IN folders: rename f + ".zip.part" → f + ".zip"
        FOR f IN folders: remove f                                       # спершу всі архіви, потім видалення
        RETURN true
    Команди пакувальника виконуються з umask 077: `.zip` і розпаковані каталоги доступні лише власнику. bsdtar отримує формат явно (`--format zip`): ім'я `.zip.part` формату не називає, і `-a` записав би tar.

Сховище пакується в `<root>/<id>.zip`, каталог архівів — у `<project>/.claude/context-editor/<id>.zip` (той самий `.gitignore` його приховує). Файли архівів лишаються звичайними файлами всередині `.zip` під тими самими відносними шляхами: розпакування повертає точно ті шляхи, які несуть рядки замін.

Залишковий ризик: те, що інший процес запише в каталог між записом його `.zip` і видаленням каталогу (секунди, і лише в сесію, якої не торкались PACK_IDLE_MS), губиться. Прийнято: вікно коротке, а повторна перевірка часу змін перед видаленням його лише звузила б.

### 02_52. RestoreSession  {#SP_CTX_02_52}

Purpose: повернути запаковану сесію до того, як мод чи агент звернеться до її файлів.

Processing logic (pseudocode):
    RestoreSession(id):                              # у PrepareStorage (02_15) до mkdir
        RestoreFolder(<root>/<id>)
        FOR a IN own lines of <root>/<id>/archives.txt and of <root>/<id>.where: RestoreFolder(a)   # збій каталогу архівів не забирає сховище
        IF every RestoreFolder succeeded: remove <root>/<id>.where        # інакше .zip і .where чекають наступної підготовки
    RestoreFolder(folder):
        zip = folder + ".zip"; IF zip does not exist: RETURN ok
        IF folder exists: extract zip into folder WITHOUT overwriting; remove zip     # пакування обірвалось, або живий процес створив каталог наново після пакування: нові файли лишаються, решта повертається
        ELSE: extract zip into folder + ".part"; rename folder + ".part" → folder; remove zip
    Rename never goes over an existing target (`[ ! -e to ] && mv`): `mv` замінив би файл або переніс би каталог усередину наявного.
    ON failure of the storage's own RestoreFolder: storage stays packed → PrepareStorage gives {reason: PACKED_REASON = "packed storage cannot be restored"}   # мод не пише в порожній каталог поверх запакованого стану

    NeedsRestore (prompt.submit, main session): the storage state is {reason: PACKED_REASON}, OR the published folder does not exist, OR its .zip exists → PrepareStorage(id) anew   # сесія, яку запакував інший процес, поки вона була відкрита

Розпаковує той самий інструмент, що пакував, якщо він є; інакше будь-який з Packer(): обидва читають `.zip`. Без інструмента запакована сесія лишається запакованою, і мод працює без сховища для неї (причина в рядку статусу), доки інструмент не з'явиться.

Errors:
| Condition | Result |
|-----------|--------|
| `.zip` пошкоджено або немає інструмента | `{reason}`, сховище недоступне; `.zip` лишається |
| і каталог, і `.zip` є | `.zip` розпаковується в каталог без перезапису наявних файлів, потім видаляється |
