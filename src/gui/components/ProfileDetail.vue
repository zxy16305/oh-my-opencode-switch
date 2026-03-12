<template>
  <div class="profile-detail" :class="{ 'empty': !profile }">
    <!-- Empty State -->
    <div v-if="!profile" class="empty-state">
      <div class="empty-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <h3 class="empty-title">No Profile Selected</h3>
      <p class="empty-message">
        Select a profile from the list to view its details and configuration.
      </p>
    </div>

    <!-- Profile Content -->
    <div v-else class="profile-content">
      <!-- Header Section -->
      <header class="profile-header">
        <div class="profile-title-row">
          <h2 class="profile-name">{{ profile.name }}</h2>
          <span v-if="isActive" class="active-badge">
            <span class="active-dot"></span>
            Active
          </span>
          <span v-else-if="profile.isDefault" class="default-badge">Default</span>
        </div>
        <p v-if="profile.description" class="profile-description">
          {{ profile.description }}
        </p>
      </header>

      <!-- Metadata Section -->
      <section class="metadata-section">
        <h3 class="section-title">Metadata</h3>
        <div class="metadata-grid">
          <div class="metadata-item">
            <span class="metadata-label">Created</span>
            <span class="metadata-value" :title="formatDateFull(profile.createdAt)">
              {{ formatDateRelative(profile.createdAt) }}
            </span>
          </div>
          <div class="metadata-item">
            <span class="metadata-label">Updated</span>
            <span class="metadata-value" :title="formatDateFull(profile.updatedAt)">
              {{ formatDateRelative(profile.updatedAt) }}
            </span>
          </div>
          <div v-if="profile.lastUsedAt" class="metadata-item">
            <span class="metadata-label">Last Used</span>
            <span class="metadata-value" :title="formatDateFull(profile.lastUsedAt)">
              {{ formatDateRelative(profile.lastUsedAt) }}
            </span>
          </div>
        </div>
      </section>

      <!-- Configuration Section -->
      <section class="config-section">
        <div class="config-header">
          <h3 class="section-title">Configuration</h3>
          <button class="btn-copy" @click="handleCopyConfig" title="Copy to clipboard">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            <span>Copy</span>
          </button>
        </div>
        <pre class="config-display"><code>{{ formattedConfig }}</code></pre>
      </section>

      <!-- Action Buttons -->
      <footer class="profile-actions">
        <button
          v-if="!isActive"
          class="btn btn-primary"
          @click="handleSwitch"
          title="Activate this profile"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
          <span>Switch to Profile</span>
        </button>

        <button class="btn btn-secondary" @click="handleRename" title="Rename profile">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>Rename</span>
        </button>

        <button
          class="btn btn-secondary"
          @click="handleCopyConfig"
          title="Copy configuration"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <span>Copy Config</span>
        </button>

        <button class="btn btn-danger" @click="handleDelete" title="Delete profile">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
          <span>Delete</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  profile: {
    type: Object,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: false,
  },
  config: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['switch', 'rename', 'delete', 'copy-config']);

// Format config as pretty-printed JSON
const formattedConfig = computed(() => {
  if (!props.config) return '// No configuration available';
  try {
    return JSON.stringify(props.config, null, 2);
  } catch {
    return '// Invalid configuration data';
  }
});

// Format date as relative time (e.g., "2 days ago")
function formatDateRelative(dateString) {
  if (!dateString) return 'Never';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 10) return 'Just now';
  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${diffYears}y ago`;
}

// Format date as full readable string
function formatDateFull(dateString) {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Event handlers
function handleSwitch() {
  emit('switch', props.profile);
}

function handleRename() {
  emit('rename', props.profile);
}

function handleDelete() {
  emit('delete', props.profile);
}

function handleCopyConfig() {
  emit('copy-config', props.profile, props.config);
}
</script>

<style scoped>
/* Container */
.profile-detail {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-primary, #1e1e1e);
}

.profile-detail.empty {
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: 48px 32px;
  color: var(--text-secondary, #888);
}

.empty-icon {
  margin-bottom: 20px;
  opacity: 0.5;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 8px 0;
  color: var(--text-primary, #fff);
}

.empty-message {
  font-size: 14px;
  margin: 0;
  line-height: 1.5;
}

/* Profile Content */
.profile-content {
  padding: 24px;
}

/* Header */
.profile-header {
  margin-bottom: 24px;
}

.profile-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.profile-name {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary, #ffffff);
}

.active-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: rgba(46, 204, 113, 0.15);
  color: #2ecc71;
  font-size: 12px;
  font-weight: 600;
  border-radius: 20px;
  border: 1px solid rgba(46, 204, 113, 0.3);
}

.active-dot {
  width: 8px;
  height: 8px;
  background: #2ecc71;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.default-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  background: rgba(52, 152, 219, 0.15);
  color: #3498db;
  font-size: 12px;
  font-weight: 600;
  border-radius: 20px;
  border: 1px solid rgba(52, 152, 219, 0.3);
}

.profile-description {
  font-size: 14px;
  color: var(--text-secondary, #a0a0a0);
  margin: 0;
  line-height: 1.5;
}

/* Sections */
.metadata-section,
.config-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #888);
  margin: 0 0 16px 0;
}

/* Metadata Grid */
.metadata-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 16px;
}

.metadata-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metadata-label {
  font-size: 12px;
  color: var(--text-secondary, #888);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.metadata-value {
  font-size: 14px;
  color: var(--text-primary, #fff);
  font-weight: 500;
  cursor: help;
}

/* Config Section */
.config-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.btn-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--border-color, #444);
  border-radius: 6px;
  color: var(--text-secondary, #888);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-copy:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: var(--text-secondary, #666);
  color: var(--text-primary, #fff);
}

.config-display {
  background: var(--bg-secondary, #2a2a2a);
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  padding: 16px;
  margin: 0;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, #a0a0a0);
}

.config-display code {
  font-family: inherit;
}

/* Action Buttons */
.profile-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color, #444);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn svg {
  flex-shrink: 0;
}

.btn-primary {
  background: var(--primary-color, #3498db);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.3);
}

.btn-secondary {
  background: var(--bg-secondary, #2d2d2d);
  color: var(--text-primary, #ffffff);
  border: 1px solid var(--border-color, #444);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-tertiary, #3d3d3d);
  border-color: var(--text-secondary, #666);
}

.btn-danger {
  background: transparent;
  color: #e74c3c;
  border: 1px solid #e74c3c;
}

.btn-danger:hover:not(:disabled) {
  background: #e74c3c;
  color: white;
}
</style>
