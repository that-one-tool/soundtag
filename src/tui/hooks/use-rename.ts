import { useRef, useState } from "react";
import type { EntryRenamer } from "../entry-renamer.js";
import { editNameField, type KeyPress } from "../name-field.js";
import type { RenameDraft } from "../rename-draft.js";
import type { BrowserEntry } from "../types.js";

type SaveDraft = (draft: RenameDraft) => void;

type DraftUpdate = (draft: RenameDraft, save: SaveDraft) => RenameDraft | null;

function isCancelKey({ input, key }: KeyPress): boolean {
    return key.escape || (key.ctrl && input === "c");
}

function getDraftUpdate(press: KeyPress): DraftUpdate {
    if (press.key.return) {
        return (draft, save) => {
            save(draft);
            return null;
        };
    }

    if (isCancelKey(press)) {
        return () => null;
    }

    return (draft) => ({ ...draft, field: editNameField(draft.field, press) });
}

// Refs let keys read in the same tick see the state the previous key left.
function useDraftState() {
    const [draft, setDraft] = useState<RenameDraft | null>(null);
    const latest = useRef(draft);
    const update = (next: RenameDraft | null) => {
        latest.current = next;
        setDraft(next);
    };
    return { draft, latest, update };
}

function useSaving(renamer: EntryRenamer) {
    const saving = useRef(false);
    const save = (draft: RenameDraft) => {
        saving.current = true;
        void renamer.rename(draft).finally(() => (saving.current = false));
    };
    return { saving, save };
}

export interface RenameControls {
    draft: RenameDraft | null;
    isEditing(): boolean;
    isSaving(): boolean;
    startRename(entry: BrowserEntry | undefined): void;
    editDraft(press: KeyPress): void;
}

export function useRename(renamer: EntryRenamer): RenameControls {
    const { draft, latest, update } = useDraftState();
    const { saving, save } = useSaving(renamer);
    return {
        draft,
        isEditing: () => latest.current !== null,
        isSaving: () => saving.current,
        startRename: (entry) => update(renamer.startDraft(entry)),
        editDraft: (press) => {
            if (latest.current) {
                update(getDraftUpdate(press)(latest.current, save));
            }
        },
    };
}
