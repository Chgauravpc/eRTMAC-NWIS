import React from 'react';
import { Card } from '../../components/ui/Primitives';

export function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl py-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">About the data</h1>
      <Card className="p-6">
        <h2 className="mb-4 text-xl font-semibold">Synthetic and Real Data</h2>
        <p className="mb-4 text-gray-700">
          The Nearby Wells Intelligence System (NWIS) uses a mix of synthetic and real data to demonstrate its capabilities.
        </p>
        <ul className="mb-4 list-inside list-disc text-gray-700">
          <li><strong>Real Data (Volve/NPD):</strong> Licensed under Equinor&apos;s Volve dataset license and the Norwegian Petroleum Directorate. Used for genuine offset correlation and analysis.</li>
          <li><strong>Synthetic Data:</strong> Generated specifically for testing and demonstration purposes. Wells starting with <code>SYN{'-'}</code> are purely synthetic.</li>
        </ul>
        <p className="text-gray-700">
          Provenance badges are displayed throughout the application to clearly distinguish between Synthetic, Analog, and Direct data sources.
        </p>
      </Card>
    </div>
  );
}

export default AboutPage;
