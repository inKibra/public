use std::sync::{Mutex};
use std::path::{Path, PathBuf};
use std::fs;
use reqwest::Url;
use tauri::{
  plugin::{Builder, TauriPlugin},
  Manager, Runtime, AppHandle,
};

pub use models::*;

mod commands;
mod error;
mod models;

pub use error::{Error, Result};

/// Extensions to [`tauri::AppHandle`] to access the OTA APIs.
pub trait OTAExt<R: Runtime> {
  fn ota_manager(&self) -> &UpdateManager<R>;
}

impl<R: Runtime, T: Manager<R>> crate::OTAExt<R> for T {
  fn ota_manager(&self) -> &UpdateManager<R> {
    self.state::<UpdateManager<R>>().inner()
  }
}

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ota")
    .invoke_handler(tauri::generate_handler![
        commands::prepare,
        commands::prepare_bundle
    ])
    .setup(|app, _api| {
      app.manage(UpdateManager::new(app.clone()));
      Ok(())
    })
    .build()
}

/// Update manager that handles the OTA update process
pub struct UpdateManager<R: Runtime> {
    app_handle: AppHandle<R>,
    update_state: Mutex<UpdateState>,
}

struct UpdateState {
    current_version: Option<String>,
    last_error: Option<String>,
    update_in_progress: bool,
    latest_manifest: Option<UpdateManifest>,
    bundle_update_in_progress: bool,
}

impl<R: Runtime> UpdateManager<R> {
    pub fn new(app_handle: AppHandle<R>) -> Self {
        // Initialize update state
        let update_state = Mutex::new(UpdateState {
            current_version: None,
            last_error: None,
            update_in_progress: false,
            latest_manifest: None,
            bundle_update_in_progress: false,
        });

        // Create the update manager
        let manager = Self {
            app_handle,
            update_state,
        };

        // Try to load the current version
        if let Ok(version) = manager.load_current_version() {
            let mut state = manager.update_state.lock().unwrap();
            state.current_version = Some(version.clone());
            
            // Try to load the manifest
            let _ = manager.load_manifest(&version);
        }

        manager
    }

    // Get the cache directory where updates are stored
    fn get_storage_dir(&self) -> PathBuf {
        self.app_handle.path().app_cache_dir().unwrap()
    }

    // Get the path to store version info
    fn get_version_file_path(&self) -> PathBuf {
        self.get_storage_dir().join("current-version.txt")
    }

    // Get the path for storing manifest
    fn get_manifest_path(&self, version: &str) -> PathBuf {
        self.get_storage_dir().join(format!("manifest-{}.json", version))
    }

    // Get the path for storing the update content
    fn get_update_content_path(&self, version: &str) -> PathBuf {
        self.get_storage_dir().join(format!("update-content-{}.js", version))
    }

    // Load the current version from storage
    fn load_current_version(&self) -> Result<String> {
        let version_path = self.get_version_file_path();
        if !version_path.exists() {
            return Err(Error::NoUpdateAvailable);
        }
        
        let version = fs::read_to_string(version_path)?;
        Ok(version.trim().to_string())
    }

    // Load the manifest for a specific version
    fn load_manifest(&self, version: &str) -> Result<UpdateManifest> {
        let manifest_path = self.get_manifest_path(version);
        if !manifest_path.exists() {
            return Err(Error::MissingConfig("Manifest not found".into()));
        }
        
        let manifest_json = fs::read_to_string(manifest_path)?;
        let manifest: UpdateManifest = serde_json::from_str(&manifest_json)?;
        Ok(manifest)
    }

    // Load the update content for a specific version
    fn load_update_content(&self, version: &str) -> Result<String> {
        let content_path = self.get_update_content_path(version);
        if !content_path.exists() {
            return Err(Error::MissingConfig("Update content not found".into()));
        }
        
        let content = fs::read_to_string(content_path)?;
        Ok(content)
    }

    // Save current version to storage
    fn save_current_version(&self, version: &str) -> Result<()> {
        let version_path = self.get_version_file_path();
        
        // Ensure directory exists
        if let Some(parent) = version_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        fs::write(version_path, version)?;
        Ok(())
    }

    // Save manifest for a specific version
    fn save_manifest(&self, version: &str, manifest: &UpdateManifest) -> Result<()> {
        let manifest_path = self.get_manifest_path(version);
        
        // Ensure directory exists
        if let Some(parent) = manifest_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let manifest_json = serde_json::to_string_pretty(manifest)?;
        fs::write(manifest_path, manifest_json)?;
        Ok(())
    }

    // Save update content for a specific version
    fn save_update_content(&self, version: &str, content: &str) -> Result<()> {
        let content_path = self.get_update_content_path(version);
        
        // Ensure directory exists
        if let Some(parent) = content_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        fs::write(content_path, content)?;
        Ok(())
    }

    // Prepare - check for updates, download and return content if available
    pub async fn prepare(&self, manifest_url: String) -> Result<UpdateInfo> {
        // Check if update already in progress
        {
            let in_progress = {
                let state = self.update_state.lock().unwrap();
                state.update_in_progress
            };
            
            if in_progress {
                return Err(Error::UpdateInProgress);
            }
        }
        
        // Set update in progress
        {
            let mut state = self.update_state.lock().unwrap();
            state.update_in_progress = true;
        }
        
        // Fetch manifest
        let manifest_result = self.fetch_manifest(&manifest_url).await;
        let manifest = match manifest_result {
            Ok(m) => m,
            Err(e) => {
                // Update state with error
                {
                    let mut state = self.update_state.lock().unwrap();
                    state.last_error = Some(e.to_string());
                    state.update_in_progress = false;
                }
                
                // Try to load existing manifest and content if available
                let current_version = self.load_current_version().ok();
                if let Some(version) = current_version {
                    let manifest_result = self.load_manifest(&version);
                    let content_result = self.load_update_content(&version);
                    
                    if let (Ok(manifest), Ok(content)) = (manifest_result, content_result) {
                        return Ok(UpdateInfo {
                            update: Some(content),
                            manifest: Some(manifest),
                            error: None,
                        });
                    }
                }
                
                return Ok(UpdateInfo {
                    update: None,
                    manifest: None,
                    error: Some(e.to_string()),
                });
            }
        };
        
        // Compare versions
        let current_version = self.load_current_version().ok();
        let needs_update = match &current_version {
            Some(current) => manifest.version != *current,
            None => true,
        };
        
        // If no update needed
        if !needs_update {
            // Update state
            {
                let mut state = self.update_state.lock().unwrap();
                state.update_in_progress = false;
                state.current_version = current_version.clone();
                state.latest_manifest = Some(manifest.clone());
            }
            
            // Try to load the existing update content
            if let Some(version) = &current_version {
                if let Ok(content) = self.load_update_content(version) {
                    return Ok(UpdateInfo {
                        update: Some(content),
                        manifest: Some(manifest),
                        error: None,
                    });
                }
            }
            
            // If we couldn't load the content, download it again
            let content_result = self
                .download_update_content(&manifest, &manifest_url)
                .await;
            match content_result {
                Ok(content) => {
                    // Save the content
                    if let Err(e) = self.save_update_content(&manifest.version, &content) {
                        println!("Failed to save update content: {}", e);
                    }
                    
                    return Ok(UpdateInfo {
                        update: Some(content),
                        manifest: Some(manifest),
                        error: None,
                    });
                },
                Err(e) => {
                    return Ok(UpdateInfo {
                        update: None,
                        manifest: Some(manifest),
                        error: Some(format!("Failed to download content: {}", e)),
                    });
                }
            }
        }
        
        // Store manifest for later use
        {
            let mut state = self.update_state.lock().unwrap();
            state.latest_manifest = Some(manifest.clone());
        }
        
        // Download update content
        let content_result = self
            .download_update_content(&manifest, &manifest_url)
            .await;
        match content_result {
            Ok(content) => {
                // Update was successful
                let _ = self.save_current_version(&manifest.version);
                let _ = self.save_manifest(&manifest.version, &manifest);
                let _ = self.save_update_content(&manifest.version, &content);
                
                // Update state
                {
                    let mut state = self.update_state.lock().unwrap();
                    state.update_in_progress = false;
                    state.current_version = Some(manifest.version.clone());
                }
                
                Ok(UpdateInfo {
                    update: Some(content),
                    manifest: Some(manifest),
                    error: None,
                })
            },
            Err(e) => {
                // Download failed
                {
                    let mut state = self.update_state.lock().unwrap();
                    state.last_error = Some(e.to_string());
                    state.update_in_progress = false;
                }
                
                Ok(UpdateInfo {
                    update: None,
                    manifest: None,
                    error: Some(e.to_string()),
                })
            }
        }
    }

    // Fetch manifest from server
    async fn fetch_manifest(&self, url: &str) -> Result<UpdateManifest> {
        // Create HTTP client
        let client = reqwest::Client::new();
        
        // Fetch manifest
        let response = client.get(url).send().await?;
        let manifest: UpdateManifest = response.json().await?;
        
        Ok(manifest)
    }

    // Download update content and return it
    async fn download_update_content(
        &self,
        manifest: &UpdateManifest,
        manifest_url: &str,
    ) -> Result<String> {
        // Create HTTP client
        let client = reqwest::Client::new();

        let content_url = match Url::parse(&manifest.url) {
            Ok(url) => url,
            Err(_) => {
                let base = Url::parse(manifest_url)
                    .map_err(|err| Error::Other(format!("Invalid manifest URL: {err}")))?;
                base.join(&manifest.url)
                    .map_err(|err| Error::Other(format!("Invalid update URL: {err}")))?
            }
        };
        
        // Download file directly
        let response = client.get(content_url).send().await?;
        let content = response.text().await?;
        
        // Verify hash
        self.verify_content_hash(&content, &manifest.hash)?;
        
        Ok(content)
    }

    // Verify content hash
    fn verify_content_hash(&self, content: &str, expected_hash: &str) -> Result<()> {
        use sha2::{Sha256, Digest};
        
        // Calculate hash
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = hex::encode(hasher.finalize());
        
        // Compare hashes
        if hash != expected_hash {
            return Err(Error::HashVerificationFailed);
        }
        
        Ok(())
    }

    fn is_bundle_update_in_progress(&self) -> bool {
        let state = self.update_state.lock().unwrap();
        state.bundle_update_in_progress
    }

    fn set_bundle_update_in_progress(&self, value: bool) {
        let mut state = self.update_state.lock().unwrap();
        state.bundle_update_in_progress = value;
    }

    fn get_bundle_storage_dir(&self) -> PathBuf {
        self.get_storage_dir().join("ota")
    }

    fn get_bundle_version_dir(&self, version: &str) -> PathBuf {
        self.get_bundle_storage_dir().join(version)
    }

    fn get_bundle_current_version_path(&self) -> PathBuf {
        self.get_bundle_storage_dir().join("current-version.txt")
    }

    fn get_bundle_manifest_path(&self, version: &str) -> PathBuf {
        self.get_bundle_version_dir(version).join("manifest.json")
    }

    fn load_bundle_current_version(&self) -> Result<Option<String>> {
        let version_path = self.get_bundle_current_version_path();
        if !version_path.exists() {
            return Ok(None);
        }
        let version = fs::read_to_string(version_path)?;
        Ok(Some(version.trim().to_string()))
    }

    fn save_bundle_current_version(&self, version: &str) -> Result<()> {
        let version_path = self.get_bundle_current_version_path();
        if let Some(parent) = version_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(version_path, version)?;
        Ok(())
    }

    fn load_bundle_manifest(&self, version: &str) -> Result<ClientBundleManifest> {
        let manifest_path = self.get_bundle_manifest_path(version);
        if !manifest_path.exists() {
            return Err(Error::MissingConfig("Manifest not found".into()));
        }
        let manifest_json = fs::read_to_string(manifest_path)?;
        let manifest: ClientBundleManifest = serde_json::from_str(&manifest_json)?;
        Ok(manifest)
    }

    fn save_bundle_manifest(
        &self,
        version: &str,
        manifest: &ClientBundleManifest,
    ) -> Result<()> {
        let manifest_path = self.get_bundle_manifest_path(version);
        if let Some(parent) = manifest_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let manifest_json = serde_json::to_string_pretty(manifest)?;
        fs::write(manifest_path, manifest_json)?;
        Ok(())
    }

    pub async fn prepare_bundle(&self, manifest_url: String) -> Result<BundleUpdateInfo> {
        if self.is_bundle_update_in_progress() {
            return Err(Error::UpdateInProgress);
        }

        self.set_bundle_update_in_progress(true);
        let info = self.prepare_bundle_inner(manifest_url).await;
        self.set_bundle_update_in_progress(false);
        Ok(info)
    }

    async fn prepare_bundle_inner(&self, manifest_url: String) -> BundleUpdateInfo {
        let manifest = match self.fetch_bundle_manifest(&manifest_url).await {
            Ok(manifest) => manifest,
            Err(err) => return self.bundle_error_with_fallback(err),
        };

        let bundle_id = manifest.entry_full_hash.clone();
        let current_version = self.load_bundle_current_version().ok().flatten();
        let needs_update = current_version.as_deref() != Some(bundle_id.as_str());
        let version_dir = self.get_bundle_version_dir(&bundle_id);

        if !needs_update {
            if let Ok(local_manifest) = self.load_bundle_manifest(&bundle_id) {
                if version_dir.exists() {
                    return BundleUpdateInfo {
                        manifest: Some(local_manifest),
                        base_path: Some(version_dir.to_string_lossy().to_string()),
                        update: Some(false),
                        error: None,
                    };
                }
            }
        }

        match self
            .download_bundle_assets(&manifest, &manifest_url)
            .await
        {
            Ok(local_manifest) => {
                let _ = self.save_bundle_current_version(&bundle_id);
                BundleUpdateInfo {
                    manifest: Some(local_manifest),
                    base_path: Some(version_dir.to_string_lossy().to_string()),
                    update: Some(needs_update),
                    error: None,
                }
            }
            Err(err) => self.bundle_error_with_fallback(err),
        }
    }

    fn bundle_error_with_fallback(&self, err: Error) -> BundleUpdateInfo {
        if let Ok(Some(version)) = self.load_bundle_current_version() {
            if let Ok(manifest) = self.load_bundle_manifest(&version) {
                let base_path = self.get_bundle_version_dir(&version);
                return BundleUpdateInfo {
                    manifest: Some(manifest),
                    base_path: Some(base_path.to_string_lossy().to_string()),
                    update: None,
                    error: Some(err.to_string()),
                };
            }
        }

        BundleUpdateInfo {
            manifest: None,
            base_path: None,
            update: None,
            error: Some(err.to_string()),
        }
    }

    async fn fetch_bundle_manifest(&self, url: &str) -> Result<ClientBundleManifest> {
        let client = reqwest::Client::new();
        let response = client.get(url).send().await?.error_for_status()?;
        let manifest: ClientBundleManifest = response.json().await?;
        Ok(manifest)
    }

    async fn download_bundle_assets(
        &self,
        manifest: &ClientBundleManifest,
        manifest_url: &str,
    ) -> Result<ClientBundleManifest> {
        let manifest_url = Url::parse(manifest_url)
            .map_err(|err| Error::Other(format!("Invalid manifest URL: {err}")))?;
        let bundle_id = manifest.entry_full_hash.clone();
        let version_dir = self.get_bundle_version_dir(&bundle_id);

        if version_dir.exists() {
            fs::remove_dir_all(&version_dir)?;
        }
        fs::create_dir_all(&version_dir)?;

        let mut local_manifest = manifest.clone();
        if local_manifest.format.is_none() {
            local_manifest.format = Some(BundleFormat::Esm);
        }

        let entry_url = self.resolve_asset_url(&manifest_url, &manifest.entry_url)?;
        let entry_path = self.resolve_asset_local_path(&version_dir, &entry_url)?;
        let entry_bytes = self.download_asset_bytes(&entry_url).await?;
        self.verify_optional_hash(
            entry_bytes.as_slice(),
            Some(&manifest.entry_full_hash),
            manifest.entry_hash.as_deref(),
        )?;
        self.write_asset(&entry_path, entry_bytes.as_slice())?;
        let entry_path_string = entry_path.to_string_lossy().to_string();
        local_manifest.entry_url = entry_path_string.clone();

        for chunk in local_manifest.chunks.iter_mut() {
            if chunk.kind.as_deref() == Some("entry-point")
                || chunk.url == manifest.entry_url
            {
                chunk.url = entry_path_string.clone();
                continue;
            }

            let chunk_url = self.resolve_asset_url(&manifest_url, &chunk.url)?;
            let chunk_path = self.resolve_asset_local_path(&version_dir, &chunk_url)?;
            let chunk_bytes = self.download_asset_bytes(&chunk_url).await?;
            self.verify_optional_hash(
                chunk_bytes.as_slice(),
                chunk.full_hash.as_deref(),
                chunk.hash.as_deref(),
            )?;
            self.write_asset(&chunk_path, chunk_bytes.as_slice())?;
            chunk.url = chunk_path.to_string_lossy().to_string();
        }

        if let Some(chunk_map) = local_manifest.chunk_map.as_mut() {
            for value in chunk_map.values_mut() {
                let chunk_url = self.resolve_asset_url(&manifest_url, value)?;
                let chunk_path = self.resolve_asset_local_path(&version_dir, &chunk_url)?;
                *value = chunk_path.to_string_lossy().to_string();
            }
        }

        if let Some(css_url) = manifest.css_url.as_ref() {
            let resolved_css_url = self.resolve_asset_url(&manifest_url, css_url)?;
            let css_path = self.resolve_asset_local_path(&version_dir, &resolved_css_url)?;
            let css_bytes = self.download_asset_bytes(&resolved_css_url).await?;
            if let Some(css_hash) = manifest.css_hash.as_deref() {
                self.verify_hash_prefix(css_bytes.as_slice(), css_hash)?;
            }
            self.write_asset(&css_path, css_bytes.as_slice())?;
            local_manifest.css_url = Some(css_path.to_string_lossy().to_string());
        } else {
            local_manifest.css_url = None;
        }

        self.save_bundle_manifest(&bundle_id, &local_manifest)?;
        Ok(local_manifest)
    }

    fn resolve_asset_url(&self, manifest_url: &Url, asset_url: &str) -> Result<Url> {
        manifest_url
            .join(asset_url)
            .map_err(|err| Error::Other(format!("Invalid asset URL: {err}")))
    }

    fn resolve_asset_local_path(&self, version_dir: &Path, asset_url: &Url) -> Result<PathBuf> {
        let relative_path = asset_url.path().trim_start_matches('/');
        if relative_path.is_empty() {
            return Err(Error::MissingConfig("Asset path is empty".into()));
        }
        if relative_path.split('/').any(|segment| segment == "..") {
            return Err(Error::Other("Invalid asset path".into()));
        }
        Ok(version_dir.join(relative_path))
    }

    async fn download_asset_bytes(&self, url: &Url) -> Result<Vec<u8>> {
        let client = reqwest::Client::new();
        let response = client.get(url.clone()).send().await?.error_for_status()?;
        Ok(response.bytes().await?.to_vec())
    }

    fn write_asset(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
        Ok(())
    }

    fn verify_optional_hash(
        &self,
        bytes: &[u8],
        full_hash: Option<&str>,
        short_hash: Option<&str>,
    ) -> Result<()> {
        if let Some(full) = full_hash {
            return self.verify_hash_exact(bytes, full);
        }
        if let Some(short) = short_hash {
            return self.verify_hash_prefix(bytes, short);
        }
        Ok(())
    }

    fn verify_hash_exact(&self, bytes: &[u8], expected_hash: &str) -> Result<()> {
        let normalized = expected_hash.strip_prefix("sha256-").unwrap_or(expected_hash);
        let hash = self.compute_sha256(bytes);
        if hash != normalized {
            return Err(Error::HashVerificationFailed);
        }
        Ok(())
    }

    fn verify_hash_prefix(&self, bytes: &[u8], expected_hash: &str) -> Result<()> {
        let normalized = expected_hash.strip_prefix("sha256-").unwrap_or(expected_hash);
        let hash = self.compute_sha256(bytes);
        if !hash.starts_with(normalized) {
            return Err(Error::HashVerificationFailed);
        }
        Ok(())
    }

    fn compute_sha256(&self, bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        hex::encode(hasher.finalize())
    }
}
