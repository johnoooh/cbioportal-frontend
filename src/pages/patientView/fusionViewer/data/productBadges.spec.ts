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
