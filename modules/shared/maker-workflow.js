const WORKFLOW_STAGES = ['source', 'layers', 'model', 'export'];

export function setMakerWorkflow(workflow, stage, { tone = '' } = {}) {
    if (!workflow) return;

    const currentIndex = Math.max(0, WORKFLOW_STAGES.indexOf(stage));
    workflow.dataset.stage = WORKFLOW_STAGES[currentIndex];
    if (tone) {
        workflow.dataset.tone = tone;
    } else {
        delete workflow.dataset.tone;
    }

    workflow.querySelectorAll('[data-workflow-step]').forEach((step) => {
        const index = WORKFLOW_STAGES.indexOf(step.dataset.workflowStep);
        step.classList.toggle('is-complete', index < currentIndex);
        step.classList.toggle('is-current', index === currentIndex);
        step.classList.toggle('is-pending', index > currentIndex);
        step.setAttribute('aria-current', index === currentIndex ? 'step' : 'false');
    });
}

export function updateMakerPreflight(view, quality) {
    if (!quality) return;

    const sizeReadout = view?.modelSizeReadout;
    const exceedsBed = sizeReadout?.dataset.bedFit === 'overflow';
    const hasStructureWarning = sizeReadout?.dataset.structureWarning === 'true';
    const wasAutoFitted = sizeReadout?.dataset.autoFitted === 'true';

    let status = quality.status;
    let label = quality.label;
    let note = quality.note;

    if (exceedsBed) {
        status = 'blocked';
        label = 'Exceeds print bed';
        note = 'Lower Model Scale or choose a larger printer bed before export.';
    } else if (hasStructureWarning) {
        status = 'review';
        label = sizeReadout?.dataset.structureWarningLabel || 'Check support base';
        note = sizeReadout?.dataset.structureWarningMessage
            || 'One or more upper layers extend beyond the selected support base footprint.';
    } else if (quality.colorCount > 4 && status !== 'blocked') {
        const complexityNote = status === 'ready' ? '' : ` ${note}`;
        status = 'review';
        label = 'Additional AMS needed';
        note = `${quality.colorCount} filament colors exceed one 4-slot AMS. Merge colors or confirm a multi-AMS setup in Bambu Studio.${complexityNote}`;
    } else if (wasAutoFitted && status === 'ready') {
        label = 'Auto-fit ready';
        note = 'The model was scaled to fit the selected bed. Confirm the final dimensions before printing.';
    } else if (quality.colorCount > 0 && quality.colorCount <= 4 && status === 'ready') {
        label = 'One AMS ready';
        note = `${quality.colorCount} filament color${quality.colorCount === 1 ? '' : 's'} fit one AMS. Confirm physical slot assignments in Bambu Studio before slicing.`;
    }

    if (view?.preflightStatus) {
        view.preflightStatus.textContent = label;
        view.preflightStatus.classList.remove('is-waiting', 'is-ready', 'is-review', 'is-blocked');
        view.preflightStatus.classList.add(`is-${status}`);
    }
    if (view?.preflightLayers) {
        view.preflightLayers.textContent = quality.colorCount
            ? `${quality.colorCount} filament${quality.colorCount === 1 ? '' : 's'}`
            : '—';
        view.preflightLayers.title = quality.pathCount
            ? `${quality.pathCount.toLocaleString()} traced paths`
            : 'No traced paths';
    }
    if (view?.preflightNote) {
        view.preflightNote.textContent = note;
    }
}
