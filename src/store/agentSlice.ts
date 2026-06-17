import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SimulatedIncident, EpisodicMemory } from '../types';
import { DEFAULT_MEMORIES } from '../data/mock_data';

interface AgentState {
  incidents: SimulatedIncident[];
  activeIncidentId: string | null;
  memoryPool: EpisodicMemory[];
  simulationRunning: boolean;
  serverStatus: { ok: boolean; hasKey: boolean; checking: boolean };
}

const initialState: AgentState = {
  incidents: [],
  activeIncidentId: null,
  memoryPool: DEFAULT_MEMORIES,
  simulationRunning: false,
  serverStatus: { ok: false, hasKey: false, checking: true },
};

const agentSlice = createSlice({
  name: 'agent',
  initialState,
  reducers: {
    addIncident: (state, action: PayloadAction<SimulatedIncident>) => {
      // unshift inserts at the beginning
      state.incidents.unshift(action.payload);
    },
    updateIncident: (state, action: PayloadAction<{ id: string; changes: Partial<SimulatedIncident> }>) => {
      const inc = state.incidents.find(i => i.id === action.payload.id);
      if (inc) {
        Object.assign(inc, action.payload.changes);
      }
    },
    appendLogs: (state, action: PayloadAction<{ id: string; logs: string[] }>) => {
      const inc = state.incidents.find(i => i.id === action.payload.id);
      if (inc) {
        inc.logs.push(...action.payload.logs);
      }
    },
    setActiveIncidentId: (state, action: PayloadAction<string | null>) => {
      state.activeIncidentId = action.payload;
    },
    setMemoryPool: (state, action: PayloadAction<EpisodicMemory[]>) => {
      state.memoryPool = action.payload;
    },
    addMemory: (state, action: PayloadAction<EpisodicMemory>) => {
      state.memoryPool.unshift(action.payload);
    },
    setSimulationRunning: (state, action: PayloadAction<boolean>) => {
      state.simulationRunning = action.payload;
    },
    setServerStatus: (state, action: PayloadAction<AgentState['serverStatus']>) => {
      state.serverStatus = action.payload;
    }
  }
});

export const { 
  addIncident, 
  updateIncident, 
  appendLogs,
  setActiveIncidentId, 
  setMemoryPool, 
  addMemory, 
  setSimulationRunning, 
  setServerStatus 
} = agentSlice.actions;
export default agentSlice.reducer;
