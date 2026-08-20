import * as React from 'react';
import { assert } from 'chai';
import { mount } from 'enzyme';
import { ProductBadgeRow } from './ProductBadgeRow';
import { FrameStatus, getFrameStatusDisplay } from '../data/frameStatus';

describe('ProductBadgeRow', () => {
    it('renders the frame label and caller letters on a called in-frame combo', () => {
        const wrapper = mount(
            <ProductBadgeRow
                frame={getFrameStatusDisplay(FrameStatus.InFrame)}
                callerState={{
                    kind: 'called',
                    callers: ['Arriba', 'FusionCatcher'],
                    rawCallMethod: 'AF',
                }}
            />
        );
        assert.include(wrapper.text(), 'In frame');
        assert.include(wrapper.text(), 'AF');
    });

    it('renders a user-selected marker + Frame unknown off the called combo', () => {
        const wrapper = mount(
            <ProductBadgeRow
                frame={getFrameStatusDisplay(FrameStatus.Unknown)}
                callerState={{
                    kind: 'userSelected',
                    calledTranscriptLabel: 'ENST_5::ENST_3',
                }}
            />
        );
        assert.include(wrapper.text(), 'Frame unknown');
        assert.include(wrapper.text().toLowerCase(), 'alternate isoform');
    });

    it('renders the out-of-frame display', () => {
        const wrapper = mount(
            <ProductBadgeRow
                frame={getFrameStatusDisplay(FrameStatus.OutOfFrame)}
                callerState={{
                    kind: 'called',
                    callers: [],
                    rawCallMethod: 'TRANSLOCATION',
                }}
            />
        );
        assert.include(wrapper.text(), 'Out of frame');
        // DNA-SV variant class still shows on the called combo.
        assert.include(wrapper.text(), 'TRANSLOCATION');
    });
});

describe('ProductBadgeRow with no caller identity', () => {
    it('renders the frame pill alone, with no empty caller pill', () => {
        const wrapper = mount(
            <ProductBadgeRow
                frame={getFrameStatusDisplay(FrameStatus.Unknown)}
                callerState={{ kind: 'noCallerInfo' }}
            />
        );
        assert.include(wrapper.text(), 'Frame unknown');
        assert.notInclude(wrapper.text(), 'Fusion');
        assert.equal(wrapper.find('span[data-test="caller-pill"]').length, 0);
    });
});
