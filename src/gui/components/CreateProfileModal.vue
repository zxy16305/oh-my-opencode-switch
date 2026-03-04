<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="handleCancel">
      <div class="modal-container">
        <div class="modal-header">
          <h2>Create Profile</h2>
          <button class="close-btn" @click="handleCancel" aria-label="Close">&times;</button>
        </div>

        <form class="modal-body" @submit.prevent="handleSubmit">
          <div class="form-group">
            <label for="profile-name">Profile Name <span class="required">*</span></label>
            <input
              id="profile-name"
              ref="nameInputRef"
              v-model="profileName"
              type="text"
              placeholder="Enter profile name"
              :class="{ 'input-error': nameError }"
              @input="validateName"
            />
            <p v-if="nameError" class="error-message">{{ nameError }}</p>
            <p class="help-text">
              Must start and end with alphanumeric characters. Can contain letters, numbers,
              hyphens, and underscores.
            </p>
          </div>

          <div class="form-group">
            <label for="profile-description">Description</label>
            <textarea
              id="profile-description"
              v-model="description"
              rows="3"
              placeholder="Optional description for this profile"
              maxlength="200"
            ></textarea>
            <p class="char-count">{{ description.length }}/200</p>
          </div>
        </form>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="handleCancel">Cancel</button>
          <button type="button" class="btn btn-primary" :disabled="!isValid" @click="handleSubmit">
            Create
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  existingProfiles: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['close', 'submit']);

const nameInputRef = ref(null);
const profileName = ref('');
const description = ref('');
const nameError = ref('');

// Profile name validation pattern
const validNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/;
const reservedNames = ['current', 'default', 'active', 'null', 'undefined', 'true', 'false'];

const isValid = computed(() => {
  const trimmedName = profileName.value.trim();
  if (!trimmedName) return false;
  if (nameError.value) return false;

  // Perform full validation
  if (trimmedName.length < 1 || trimmedName.length > 50) return false;
  if (!validNamePattern.test(trimmedName)) return false;
  if (reservedNames.includes(trimmedName.toLowerCase())) return false;

  // Check for duplicates
  const duplicate = props.existingProfiles.some(
    (name) => name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) return false;

  return true;
});

const validateName = () => {
  const trimmedName = profileName.value.trim();

  if (!trimmedName) {
    nameError.value = 'Profile name is required';
    return;
  }

  if (trimmedName.length < 1 || trimmedName.length > 50) {
    nameError.value = 'Profile name must be between 1 and 50 characters';
    return;
  }

  if (!validNamePattern.test(trimmedName)) {
    nameError.value =
      'Profile name must start and end with alphanumeric characters, and can only contain letters, numbers, hyphens, and underscores';
    return;
  }

  if (reservedNames.includes(trimmedName.toLowerCase())) {
    nameError.value = 'This profile name is reserved';
    return;
  }

  // Check for duplicates
  const duplicate = props.existingProfiles.some(
    (name) => name.toLowerCase() === trimmedName.toLowerCase()
  );
  if (duplicate) {
    nameError.value = 'A profile with this name already exists';
    return;
  }

  nameError.value = '';
};

const handleSubmit = () => {
  validateName();
  if (!isValid.value) return;

  emit('submit', {
    name: profileName.value.trim(),
    description: description.value.trim(),
  });
};

const handleCancel = () => {
  emit('close');
};

// Reset form when modal opens
watch(
  () => props.visible,
  (newVal) => {
    if (newVal) {
      profileName.value = '';
      description.value = '';
      nameError.value = '';
      // Focus the name input after modal opens
      nextTick(() => {
        nameInputRef.value?.focus();
      });
    }
  }
);
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-container {
  background: var(--bg-color, #ffffff);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  width: 100%;
  max-width: 400px;
  margin: 16px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-color, #2c3e50);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-color, #2c3e50);
  opacity: 0.6;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  opacity: 1;
}

.modal-body {
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group:last-child {
  margin-bottom: 0;
}

label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-color, #2c3e50);
}

.required {
  color: #e74c3c;
}

input[type='text'],
textarea {
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--border-color, #e0e0e0);
  border-radius: 4px;
  background: var(--bg-color, #ffffff);
  color: var(--text-color, #2c3e50);
  transition: border-color 0.2s;
  font-family: inherit;
}

input[type='text']:focus,
textarea:focus {
  outline: none;
  border-color: var(--primary-color, #3498db);
}

.input-error {
  border-color: #e74c3c !important;
}

.error-message {
  color: #e74c3c;
  font-size: 12px;
  margin: 6px 0 0;
}

.help-text {
  font-size: 12px;
  color: var(--text-secondary, #7f8c8d);
  margin: 6px 0 0;
  line-height: 1.4;
}

.char-count {
  font-size: 12px;
  color: var(--text-secondary, #7f8c8d);
  margin: 6px 0 0;
  text-align: right;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border-color, #e0e0e0);
}

.btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #f5f5f5;
  border: 1px solid var(--border-color, #e0e0e0);
  color: var(--text-color, #2c3e50);
}

.btn-secondary:hover:not(:disabled) {
  background: #e8e8e8;
}

.btn-primary {
  background: var(--primary-color, #3498db);
  border: 1px solid var(--primary-color, #3498db);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #2980b9;
}
</style>
