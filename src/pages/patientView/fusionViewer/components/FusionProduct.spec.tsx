import * as React from 'react';
import { assert } from 'chai';
import { mount } from 'enzyme';
import { FusionProduct } from './FusionProduct';
import { TranscriptData, GenePartner } from '../data/types';

const PRODUCT_HEIGHT = 20;

function partner(symbol: string, position: number): GenePartner {
    return {
        symbol,
        chromosome: '1',
        position,
        selectedTranscriptId: `ENST_${symbol}`,
        siteDescription: '',
    };
}

function transcript(over: Partial<TranscriptData> = {}): TranscriptData {
    return {
        transcriptId: 'ENST_T',
        displayName: 'ENST_T',
        gene: 'G',
        biotype: 'protein_coding',
        strand: '+' as const,
        txStart: 1000,
        txEnd: 5000,
        exons: [
            { number: 1, start: 1000, end: 1099 },
            { number: 2, start: 4000, end: 4999 },
        ],
        isForteSelected: false,
        isCallerSelected: false,
        isCanonical: true,
        domains: [],
        utrs: [],
        ...over,
    };
}

function mountProduct(t3p: TranscriptData) {
    return mount(
        <svg>
            <FusionProduct
                gene1={partner('A', 1050)}
                gene2={partner('B', 4100)}
                forteTranscript5p={transcript()}
                forteTranscript3p={t3p}
                x={0}
                y={0}
                width={800}
            />
        </svg>
    );
}

describe('FusionProduct UTR rendering', () => {
    it('splits a part-coding terminal exon into coding and UTR pieces', () => {
        // Exon 2 is 4000-4999 with coding stopping at 4099: a short coding head
        // and a long untranslated tail. Drawing it as one full-height block
        // (the previous behaviour) made it read as the largest coding region in
        // the product -- the IGF2R final-exon case.
        const wrapper = mountProduct(
            transcript({
                utrs: [{ start: 4100, end: 4999, type: 'three_prime' }],
            })
        );

        const heights = wrapper
            .find('rect')
            .map(r => Number(r.prop('height')))
            .filter(h => h === PRODUCT_HEIGHT || h === PRODUCT_HEIGHT / 2);

        assert.include(
            heights,
            PRODUCT_HEIGHT / 2,
            'expected a half-height UTR piece'
        );
        assert.include(
            heights,
            PRODUCT_HEIGHT,
            'expected a full-height coding piece'
        );
    });

    it('draws a fully coding exon as a single full-height block', () => {
        const wrapper = mountProduct(transcript({ utrs: [] }));

        const halfHeight = wrapper
            .find('rect')
            .filterWhere(r => Number(r.prop('height')) === PRODUCT_HEIGHT / 2);

        assert.equal(halfHeight.length, 0);
    });
});
