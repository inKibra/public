use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    Ready,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub url: String,
    pub hash: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub update: Option<String>,
    pub manifest: Option<UpdateManifest>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareArgs {
    pub manifest_url: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum BundleFormat {
    Esm,
    Iife,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClientBundleChunk {
    pub url: String,
    pub hash: Option<String>,
    pub full_hash: Option<String>,
    pub import_path: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClientBundleManifest {
    pub version: String,
    pub build_number: Option<u64>,
    pub entry_url: String,
    pub entry_hash: Option<String>,
    pub entry_full_hash: String,
    pub chunks: Vec<ClientBundleChunk>,
    pub chunk_map: Option<HashMap<String, String>>,
    pub css_url: Option<String>,
    pub css_hash: Option<String>,
    pub format: Option<BundleFormat>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleUpdateInfo {
    pub manifest: Option<ClientBundleManifest>,
    pub base_path: Option<String>,
    pub update: Option<bool>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareBundleArgs {
    pub manifest_url: String,
}
