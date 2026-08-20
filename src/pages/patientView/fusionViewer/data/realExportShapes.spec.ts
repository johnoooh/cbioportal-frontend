import { assert } from 'chai';
import { StructuralVariant } from 'cbioportal-ts-api-client';
import { convertStructuralVariantToFusionEvent } from './structuralVariantAdapter';

/**
 * Golden tests pinned to the SHAPE of the real `msktarget` export.
 *
 * These fixtures are transcribed field-for-field from an ALK cohort export
 * (sample identifiers replaced with placeholders) rather than hand-invented,
 * because every data regression found so far came from the demo fixtures not
 * resembling production: they carried no `connectionType`, no `-1` sentinels,
 * and caller letters in `variantClass`. When upstream changes an export,
 * update these fixtures and let the assertions show what moves.
 *
 * Two record types share one schema:
 *   - GRCh38 rows: MSK-TARGET RNA fusion calls  (variantClass "Fusion")
 *   - GRCh37 rows: IMPACT DNA structural variants (INVERSION/TRANSLOCATION/...)
 */
function makeRealSV(overrides: Partial<StructuralVariant>): StructuralVariant {
    return ({
        uniqueSampleKey: 'key',
        uniquePatientKey: 'pkey',
        molecularProfileId: 'msktarget_structural_variants',
        sampleId: 'SAMPLE_A',
        patientId: 'PATIENT_A',
        studyId: 'msktarget',
        center: '',
        svStatus: 'SOMATIC',
        // Columns the export leaves unpopulated on every row.
        dnaSupport: 'NA',
        rnaSupport: 'NA',
        site1EntrezGeneId: 238,
        site2EntrezGeneId: 27436,
        normalReadCount: -1,
        normalVariantCount: -1,
        normalSplitReadCount: -1,
        normalPairedEndReadCount: -1,
        ...overrides,
    } as unknown) as StructuralVariant;
}

/** A real MSK-TARGET RNA fusion row: EML4 exon 21 :: ALK exon 20. */
const TARGET_RNA_FUSION = makeRealSV({
    ncbiBuild: 'GRCh38',
    site1HugoSymbol: 'EML4',
    site1Chromosome: '2',
    site1Position: 42326252,
    site1Description: 'Exon 21 of EML4(+)',
    site1EnsemblTranscriptId: 'ENST00000318522.10',
    site2HugoSymbol: 'ALK',
    site2Chromosome: '2',
    site2Position: 29223528,
    site2Description: 'Exon 20 of ALK(-)',
    site2EnsemblTranscriptId: 'ENST00000389048.8',
    connectionType: '5to3',
    variantClass: 'Fusion',
    // Classification text, NOT a fusion name.
    eventInfo: 'Antisense Fusion {EML4-ALK}',
    // Frame is absent from the export on every row.
    site2EffectOnFrame: 'NA',
    annotation: '',
    comments:
        'Note: The EML4::ALK fusion results in EML4 exons 1 - 21 fused to ALK ' +
        'exons 20 - 29. The fusion includes the kinase domain of ALK.',
    // RNA rows carry split reads only; the other counters are -1 sentinels.
    tumorReadCount: -1,
    tumorVariantCount: -1,
    tumorSplitReadCount: 138,
    tumorPairedEndReadCount: -1,
    length: -1,
});

/** A real IMPACT DNA structural variant row over the same gene pair. */
const IMPACT_DNA_SV = makeRealSV({
    ncbiBuild: 'GRCh37',
    site1HugoSymbol: 'ALK',
    site1Chromosome: '2',
    site1Position: 29447207,
    site1Description: 'Intron of ALK(-):813bp before exon 20',
    site1EnsemblTranscriptId: 'NA',
    site2HugoSymbol: 'EML4',
    site2Chromosome: '2',
    site2Position: 42554727,
    site2Description: 'Intron of EML4(+):1Kb before exon 21',
    site2EnsemblTranscriptId: 'NA',
    connectionType: '3to3',
    variantClass: 'INVERSION',
    eventInfo: 'Protein Fusion: in frame  {EML4:ALK}',
    site2EffectOnFrame: 'NA',
    annotation: '',
    comments: 'IMPACT Sequencing',
    // DNA rows carry variant counts; split/paired-end are -1 sentinels.
    tumorReadCount: 189616,
    tumorVariantCount: 110,
    tumorSplitReadCount: -1,
    tumorPairedEndReadCount: -1,
    length: 13107520,
});

describe('real msktarget export shapes', () => {
    describe('MSK-TARGET RNA fusion row (GRCh38)', () => {
        const fe = convertStructuralVariantToFusionEvent(TARGET_RNA_FUSION);

        it('labels the fusion from the gene symbols, not the Event Info text', () => {
            assert.equal(fe.fusion, 'EML4::ALK');
        });

        it('keeps the Event Info classification on eventLabel', () => {
            assert.equal(fe.eventLabel, 'Antisense Fusion {EML4-ALK}');
        });

        it('strips the version suffix from the caller transcript ids', () => {
            assert.equal(fe.gene1.selectedTranscriptId, 'ENST00000318522');
            assert.equal(fe.gene2!.selectedTranscriptId, 'ENST00000389048');
        });

        it('reports split reads as support when variant count is the -1 sentinel', () => {
            assert.equal(fe.totalReadSupport, 138);
        });

        it('classifies the row as RNA-derived', () => {
            assert.isTrue(fe.isRnaDerived);
        });

        it('has no frame call, because the export supplies none', () => {
            assert.equal(fe.frame, 'UNKNOWN');
            assert.equal(fe.frameCallMethod, '');
        });

        it('surfaces no caller identity, because Variant Class is generic', () => {
            assert.equal(fe.callMethod, 'Fusion');
        });

        it('carries the prose interpretation through as the note', () => {
            assert.include(fe.note, 'includes the kinase domain of ALK');
        });
    });

    describe('IMPACT DNA structural variant row (GRCh37)', () => {
        const fe = convertStructuralVariantToFusionEvent(IMPACT_DNA_SV);

        it('labels the fusion from the gene symbols', () => {
            assert.equal(fe.fusion, 'ALK::EML4');
        });

        it('uses the variant count as support when split reads are the sentinel', () => {
            assert.equal(fe.totalReadSupport, 110);
        });

        it('classifies the row as DNA-derived', () => {
            assert.isFalse(fe.isRnaDerived);
        });

        it('has no caller transcript ids, so the NA placeholder becomes empty', () => {
            assert.equal(fe.gene1.selectedTranscriptId, '');
            assert.equal(fe.gene2!.selectedTranscriptId, '');
        });

        it('preserves the 3to3 connection type the inversion depends on', () => {
            assert.equal(fe.connectionType, '3to3');
        });

        it('has no frame call, because the export supplies none', () => {
            assert.equal(fe.frame, 'UNKNOWN');
        });
    });
});
