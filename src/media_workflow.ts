export type MediaState = "uploading" | "processing" | "ready";

export type MediaAsset = {
  assetId: string;
  creatorId: string;
  objectKey: string;
  uploadId: string;
  state: MediaState;
};

export class WorkflowConflict extends Error {}
export class AssetMissing extends Error {}

export class MediaWorkflow {
  private readonly assets = new Map<string, MediaAsset>();

  recordUpload(asset: MediaAsset): MediaAsset {
    this.assets.set(asset.assetId, asset);
    return asset;
  }

  markProcessing(assetId: string): MediaAsset {
    const asset = this.requireAsset(assetId);
    if (asset.state !== "uploading") throw new WorkflowConflict("Asset is not accepting upload completion");
    asset.state = "processing";
    return asset;
  }

  markReady(assetId: string): MediaAsset {
    const asset = this.requireAsset(assetId);
    if (asset.state !== "processing") throw new WorkflowConflict("Asset must be processing before delivery");
    asset.state = "ready";
    return asset;
  }

  requireDelivery(assetId: string, creatorId: string): MediaAsset {
    const asset = this.requireAsset(assetId);
    if (asset.creatorId !== creatorId) throw new AssetMissing("Asset not found");
    if (asset.state !== "ready") throw new WorkflowConflict("Processed media is not ready for delivery");
    return asset;
  }

  requireAsset(assetId: string): MediaAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new AssetMissing("Asset not found");
    return asset;
  }
}
