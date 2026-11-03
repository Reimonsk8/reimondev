import { useState, useEffect, useRef } from 'react';
import { apiCall } from '../utils/api';
import { Camera } from 'lucide-react';

export default function AvatarCustomizer({
  nickname,
  userId,
  email,
  onSaved,
  avatarColor: propAvatarColor,
  setAvatarColor: propSetAvatarColor,
  avatarImage: propAvatarImage,
  setAvatarImage: propSetAvatarImage,
  loading = false
}) {
  // Use local state if props not provided, otherwise use props
  const [localColor, setLocalColor] = useState('#4a90e2');
  const [localImage, setLocalImage] = useState(null);

  const avatarColor = propAvatarColor !== undefined ? propAvatarColor : localColor;
  const setAvatarColor = propSetAvatarColor || setLocalColor;

  const avatarImage = propAvatarImage !== undefined ? propAvatarImage : localImage;
  const setAvatarImage = propSetAvatarImage || setLocalImage;

  const fileInputRef = useRef(null);

  const [displayName, setDisplayName] = useState(nickname || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDisplayName(nickname || '');
  }, [nickname]);

  // Fixed avatar size for everyone - no customization
  const avatarSize = 80;

  // Initialize from localStorage if available
  useEffect(() => {
    if (!userId) return;
    const savedColor = localStorage.getItem(`avatar_color_${userId}`);
    const savedImage = localStorage.getItem(`avatar_image_${userId}`);

    if (savedColor && !propAvatarColor) {
      setAvatarColor(savedColor);
    }
    if (savedImage && !propAvatarImage) {
      setAvatarImage(savedImage);
    }
  }, [userId]);

  // Save to localStorage when changed
  useEffect(() => {
    if (userId) {
      if (avatarColor) localStorage.setItem(`avatar_color_${userId}`, avatarColor);
      if (avatarImage) {
        localStorage.setItem(`avatar_image_${userId}`, avatarImage);
      } else {
        localStorage.removeItem(`avatar_image_${userId}`);
      }
    }
  }, [avatarColor, avatarImage, userId]);

  const handleSave = async () => {
    const clean = displayName.trim();
    if (!clean) {
      setSaveError('Name cannot be empty.');
      return;
    }
    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      await apiCall('/wallet/profile', 'POST', { nickname: clean, avatarImage }, true);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved?.();
    } catch (err) {
      setSaveError(err.message || 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  // Get initials from nickname
  const getInitials = (name) => {
    if (!name) return 'P';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const initials = getInitials(nickname);

  // Handle Image Upload with Resizing
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('File too large. Please select an image under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const image = new Image();
      image.onload = () => {
        // Resize logic to "low resolution" (max 128x128)
        const canvas = document.createElement('canvas');
        const MAX_SIZE = 128;
        let width = image.width;
        let height = image.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, width, height);

        // Convert to low-quality JPEG to simulate efficient storage
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setAvatarImage(dataUrl);

        // Optionally send to backend if needed
        // apiCall('/user/avatar', 'POST', { avatarImage: dataUrl }).catch(console.error);
      };
      image.src = readerEvent.target.result;
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setAvatarImage('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Color presets
  const colorPresets = [
    '#4a90e2', // Blue
    '#ff6b6b', // Red
    '#4ecdc4', // Teal
    '#f7c948', // Gold
    '#95e1d3', // Mint
    '#f38181', // Pink
    '#aa96da', // Purple
    '#fcbad3', // Light Pink
  ];

  return (
    <div className="avatar-customizer">
      <div className="card-header">
        <div>
          <p className="eyebrow">Avatar & Profile</p>
          <h3>Customize your Avatar</h3>
        </div>
      </div>

      <div className="avatar-control-group" style={{ marginBottom: '18px' }}>
        <label className="form-label" htmlFor="display-name">Display Name</label>
        <input
          id="display-name"
          className="form-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={30}
        />
        {email && (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '6px' }}>
            <span style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.05em' }}>Email: </span>
            {email}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px' }}>
          <button
            className="primary-button"
            onClick={handleSave}
            disabled={saving || loading}
            style={{ padding: '8px 18px', fontSize: '13px' }}
          >
            {saving ? 'Saving…' : loading ? 'Loading…' : saved ? 'Saved ✓' : 'Save Profile'}
          </button>
          {saveError && <span style={{ color: '#ef4444', fontSize: '12px' }}>{saveError}</span>}
        </div>
      </div>

      <div className="avatar-preview-section">
        <div
          className="avatar-circle"
          style={{
            width: `${avatarSize}px`,
            height: `${avatarSize}px`,
            backgroundColor: avatarImage ? 'transparent' : avatarColor,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: `${avatarSize * 0.4}px`,
            fontWeight: 'bold',
            color: '#fff',
            margin: '0 auto 20px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            overflow: 'hidden',
            position: 'relative',
            border: '2px solid rgba(255,255,255,0.1)'
          }}
        >
          {avatarImage ? (
            <img
              src={avatarImage}
              alt="Avatar"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            initials
          )}
        </div>
        <p style={{ textAlign: 'center', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '20px' }}>
          {nickname || 'Player'}
        </p>
      </div>

      <div className="avatar-controls">
        {/* Color Selection */}
        <div className="avatar-control-group">
          <label className="form-label">Base Color</label>
          <div className="color-presets">
            {colorPresets.map((color) => (
              <button
                key={color}
                className={`color-preset ${avatarColor === color && !avatarImage ? 'active' : ''}`}
                style={{
                  backgroundColor: color,
                  width: '35px',
                  height: '35px',
                  borderRadius: '50%',
                  border: avatarColor === color ? '3px solid #fff' : '2px solid rgba(255, 255, 255, 0.3)',
                  cursor: 'pointer',
                  opacity: avatarImage ? 0.5 : 1, // Dim if image is active
                  transition: 'all 0.2s',
                }}
                onClick={() => {
                  setAvatarColor(color);
                  setAvatarImage(null); // Switching to color clears image
                }}
                title={color}
              />
            ))}
          </div>
          <input
            type="color"
            value={avatarColor}
            onChange={(e) => {
              setAvatarColor(e.target.value);
              setAvatarImage(null);
            }}
            style={{
              width: '100%',
              height: '40px',
              marginTop: '10px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              cursor: 'pointer',
              opacity: avatarImage ? 0.5 : 1
            }}
          />
        </div>

        {/* Image Upload */}
        <div className="avatar-control-group" style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px' }}>
          <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Profile Image</span>
            {avatarImage && (
              <button
                onClick={clearImage}
                style={{ background: 'none', border: 'none', color: '#ff6b6b', fontSize: '12px', cursor: 'pointer' }}
              >
                Remove
              </button>
            )}
          </label>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            onChange={handleImageUpload}
            style={{ display: 'none' }}
            id="avatar-upload"
          />

          <label
            htmlFor="avatar-upload"
            className="secondary-button"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              textAlign: 'center',
              cursor: 'pointer',
              marginTop: '5px'
            }}
          >
            <Camera size={16} />
            <span>{avatarImage ? 'Change Image' : 'Upload Image'}</span>
          </label>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
            Images are resized to low-resolution (max 128px) for optimized storage.
          </p>
        </div>
      </div>
    </div>
  );
}
