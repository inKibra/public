use tauri::{AppHandle, command, Runtime};

use crate::{models::*, Result, OTAExt};

#[command]
pub(crate) async fn prepare<R: Runtime>(
    app_handle: AppHandle<R>,
    payload: PrepareArgs,
) -> Result<UpdateInfo> {
    app_handle.ota_manager().prepare(payload.manifest_url).await
}

#[command]
pub(crate) async fn prepare_bundle<R: Runtime>(
    app_handle: AppHandle<R>,
    payload: PrepareBundleArgs,
) -> Result<BundleUpdateInfo> {
    app_handle
        .ota_manager()
        .prepare_bundle(payload.manifest_url)
        .await
}
