import {makeProject} from '@revideo/core';
import timeline from './timelineScene';

/**
 * The single Revideo project every Short Studio production renders through.
 * Real per-production data (scenes/captions/audio/music) arrives entirely
 * via the `timelineJson` variable at render time - see RevideoRenderer.
 * Default size/fps here are placeholders; RevideoRenderer overrides them
 * from the real ProductionTimeline via `settings.projectSettings`.
 */
export default makeProject({
  scenes: [timeline],
  variables: {
    timelineJson: '{"width":1080,"height":1920,"scenes":[],"audioTracks":[]}',
  },
});
