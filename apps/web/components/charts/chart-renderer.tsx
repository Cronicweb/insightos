'use client';

import * as React from 'react';
import type { ChartSpec } from '@/lib/types';
import { ChartFrame } from './chart-frame';
import { AreaSeries, type SeriesMode } from './area-series';
import { Marimekko } from './marimekko';
import { Donut } from './donut';
import { DataTable } from './data-table';
import { Waterfall } from './waterfall';
import { ForecastChart } from './forecast-chart';
import { QualityBars } from './quality-bars';
import { Segmented } from '../ui/primitives';
import { AreaChart, BarChart3, LineChart, Table2 } from 'lucide-react';

/**
 * One switch, keyed on `ChartSpec.kind`. Adding a chart type to the Python
 * engine means adding exactly one branch here - the frontend never inspects the
 * data to decide what to draw.
 */
export function ChartRenderer({
  spec,
  className,
  height,
  withModeToggle = false,
}: {
  spec: ChartSpec;
  className?: string;
  height?: number;
  withModeToggle?: boolean;
}) {
  const [mode, setMode] = React.useState<SeriesMode>('area');

  const toolbar =
    withModeToggle && spec.kind === 'area' ? (
      <Segmented<SeriesMode>
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'bar', label: <BarChart3 className="h-3.5 w-3.5" />, title: 'Bars' },
          { value: 'area', label: <AreaChart className="h-3.5 w-3.5" />, title: 'Area' },
          { value: 'line', label: <LineChart className="h-3.5 w-3.5" />, title: 'Line' },
          { value: 'table', label: <Table2 className="h-3.5 w-3.5" />, title: 'Table' },
        ]}
      />
    ) : undefined;

  return (
    <ChartFrame spec={spec} className={className} toolbar={toolbar} dense={spec.kind === 'table'}>
      {spec.kind === 'area' ? <AreaSeries spec={spec} mode={mode} height={height} /> : null}
      {spec.kind === 'marimekko' ? <Marimekko spec={spec} height={height} /> : null}
      {spec.kind === 'donut' ? <Donut spec={spec} height={height} /> : null}
      {spec.kind === 'table' ? <DataTable spec={spec} /> : null}
      {spec.kind === 'waterfall' ? <Waterfall spec={spec} height={height} /> : null}
      {spec.kind === 'forecast' ? <ForecastChart spec={spec} height={height} /> : null}
      {spec.kind === 'bar' ? <QualityBars spec={spec} /> : null}
    </ChartFrame>
  );
}
