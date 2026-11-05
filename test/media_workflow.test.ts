import assert from "node:assert/strict";
import test from "node:test";
import { MediaWorkflow, WorkflowConflict } from "../src/media_workflow";

test("creator delivery stays closed until processing marks the asset ready", () => {
  const workflow = new MediaWorkflow();
  workflow.recordUpload({
    assetId: "asset-42",
    creatorId: "creator-7",
    objectKey: "creators/creator-7/asset-42/interview.mp4",
    uploadId: "upload-9",
    state: "uploading",
  });

  workflow.markProcessing("asset-42");
  assert.throws(
    () => workflow.requireDelivery("asset-42", "creator-7"),
    (error) => error instanceof WorkflowConflict,
  );

  workflow.markReady("asset-42");
  assert.equal(workflow.requireDelivery("asset-42", "creator-7").objectKey, "creators/creator-7/asset-42/interview.mp4");
});
