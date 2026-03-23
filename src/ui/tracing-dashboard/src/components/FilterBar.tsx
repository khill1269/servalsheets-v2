import { useState } from 'react';
import type { TraceSearchFilters } from '../types';
import './FilterBar.css';

interface FilterBarProps {
  filters: TraceSearchFilters;
  onChange: (filters: TraceSearchFilters) => void;
}

export default function FilterBar({ filters, onChange }: FilterBarProps) {
  const [localFilters, setLocalFilters] = useState<TraceSearchFilters>(filters);

  const handleChange = (
    key: keyof TraceSearchFilters,
    value: string | number | boolean | undefined
  ) => {
    const newFilters = { ...localFilters, [key]: value };
    setLocalFilters(newFilters);
  };

  const handleApply = () => {
    onChange(localFilters);
  };

  const handleReset = () => {
    setLocalFilters({});
    onChange({});
  };

  return (
    <div className="filter-bar">
      <h3>Filters</h3>

      <div className="filter-group">
        <label>Tool</label>
        <input
          type="text"
          placeholder="e.g. sheets_data"
          value={localFilters.tool || ''}
          onChange={(e) => handleChange('tool', e.target.value || undefined)}
        />
      </div>

      <div className="filter-group">
        <label>Action</label>
        <input
          type="text"
          placeholder="e.g. read_range"
          value={localFilters.action || ''}
          onChange={(e) => handleChange('action', e.target.value || undefined)}
        />
      </div>

      <div className="filter-group">
        <label>Error Code</label>
        <input
          type="text"
          placeholder="e.g. INVALID_RANGE"
          value={localFilters.errorCode || ''}
          onChange={(e) => handleChange('errorCode', e.target.value || undefined)}
        />
      </div>

      <div className="filter-group">
        <label>Min Duration (ms)</label>
        <input
          type="number"
          placeholder="e.g. 1000"
          value={localFilters.minDuration || ''}
          onChange={(e) =>
            handleChange('minDuration', e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </div>

      <div className="filter-group">
        <label>Max Duration (ms)</label>
        <input
          type="number"
          placeholder="e.g. 5000"
          value={localFilters.maxDuration || ''}
          onChange={(e) =>
            handleChange('maxDuration', e.target.value ? Number(e.target.value) : undefined)
          }
        />
      </div>

      <div className="filter-group">
        <label>Status</label>
        <select
          value={
            localFilters.success === undefined ? 'all' : localFilters.success ? 'success' : 'error'
          }
          onChange={(e) =>
            handleChange(
              'success',
              e.target.value === 'all' ? undefined : e.target.value === 'success'
            )
          }
        >
          <option value="all">All</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="filter-actions">
        <button className="btn-apply" onClick={handleApply}>
          Apply
        </button>
        <button className="btn-reset" onClick={handleReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
