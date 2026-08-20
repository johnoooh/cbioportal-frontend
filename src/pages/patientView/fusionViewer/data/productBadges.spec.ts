import { assert } from 'chai';
import {
    isCalledCombo,
    calledTranscriptLabel,
    resolveCallerState,
} from './productBadges';
import { FusionEvent } from './types';

const fusion = {
    gene1: { selectedTranscriptId: 'ENST_5' },
    gene2: { selectedTranscriptId: 'ENST_3' },
    callMethod: 'AFS',
} as FusionEvent;

describe('isCalledCombo', () => {
    it('is true only for the caller-reported combo', () => {
        assert.isTrue(isCalledCombo(fusion, 'ENST_5', 'ENST_3'));
        assert.isFalse(isCalledCombo(fusion, 'ENST_5', 'ENST_ALT'));
    });
});

describe('calledTranscriptLabel', () => {
    it('joins the two called transcripts', () => {
        assert.equal(calledTranscriptLabel(fusion), 'ENST_5::ENST_3');
    });
    it('omits the 3p side when gene2 is null', () => {
        const single = {
            gene1: { selectedTranscriptId: 'ENST_5' },
            gene2: null,
        } as FusionEvent;
        assert.equal(calledTranscriptLabel(single), 'ENST_5');
    });
});

describe('resolveCallerState', () => {
    it('returns the caller letters on the called combo', () => {
        const s = resolveCallerState(fusion, 'ENST_5', 'ENST_3');
        assert.equal(s.kind, 'called');
        if (s.kind === 'called') {
            assert.deepEqual(s.callers, [
                'Arriba',
                'FusionCatcher',
                'StarFusion',
            ]);
            assert.equal(s.rawCallMethod, 'AFS');
        }
    });

    it('returns a user-selected marker on any other combo', () => {
        const s = resolveCallerState(fusion, 'ENST_5', 'ENST_ALT');
        assert.equal(s.kind, 'userSelected');
        if (s.kind === 'userSelected') {
            assert.equal(s.calledTranscriptLabel, 'ENST_5::ENST_3');
        }
    });
});

describe('resolveCallerState with no caller identity', () => {
    // Upstream now sets Variant Class to the generic "Fusion" on RNA rows, so
    // the caller letters (A/F/S) are absent from the export entirely. A pill
    // reading "Fusion" next to the frame pill is pure noise -- suppress it.
    const generic = {
        gene1: { selectedTranscriptId: 'ENST_5' },
        gene2: { selectedTranscriptId: 'ENST_3' },
        callMethod: 'Fusion',
    } as FusionEvent;

    it('reports no caller info for a generic RNA fusion class', () => {
        const s = resolveCallerState(generic, 'ENST_5', 'ENST_3');
        assert.equal(s.kind, 'noCallerInfo');
    });

    it('still reports the raw class for a DNA structural variant', () => {
        const sv = { ...generic, callMethod: 'INVERSION' } as FusionEvent;
        const s = resolveCallerState(sv, 'ENST_5', 'ENST_3');
        assert.equal(s.kind, 'called');
        if (s.kind === 'called') {
            assert.equal(s.rawCallMethod, 'INVERSION');
        }
    });

    it('reports no caller info when the class is missing altogether', () => {
        const blank = { ...generic, callMethod: '' } as FusionEvent;
        assert.equal(
            resolveCallerState(blank, 'ENST_5', 'ENST_3').kind,
            'noCallerInfo'
        );
    });
});

describe('resolveCallerState when the caller only partly reported', () => {
    // Real exports frequently carry site1EnsemblTranscriptId but not site2.
    // The 3' side then falls back to MSK canonical. That is the app's own
    // default, not a user override, so it must not be reported as one.
    const partial = {
        gene1: { selectedTranscriptId: 'ENST_5' },
        gene2: { selectedTranscriptId: '' },
        callMethod: 'AF',
    } as FusionEvent;

    it('treats an unreported side as no claim, not a mismatch', () => {
        const s = resolveCallerState(partial, 'ENST_5', 'ENST_CANONICAL');
        assert.equal(s.kind, 'called');
    });

    it('still detects a genuine override on the side that was reported', () => {
        const s = resolveCallerState(partial, 'ENST_OTHER', 'ENST_CANONICAL');
        assert.equal(s.kind, 'userSelected');
    });

    it('keeps a DNA variant class visible when no side was reported', () => {
        const noneReported = {
            gene1: { selectedTranscriptId: '' },
            gene2: { selectedTranscriptId: '' },
            callMethod: 'INVERSION',
        } as FusionEvent;
        const s = resolveCallerState(noneReported, 'ENST_A', 'ENST_B');
        assert.equal(s.kind, 'called');
        if (s.kind === 'called') {
            assert.equal(s.rawCallMethod, 'INVERSION');
        }
    });
});
