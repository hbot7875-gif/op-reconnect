// Local QA only. Never imported by the player application.
export const sampleMessages=[{id:'1',label:'YOU',body:'Hi gayss'},{id:'2',label:'YOU',body:'I mean guys'},{id:'3',label:'AGENT',body:"I won't 😋"}]
const base={title:'My You / Still With You',countingType:'pooled',progress:240,target:500,complete:false,joined:5,capacity:6,availableSeats:1,capturedAt:'2026-09-08T10:00:00Z',version:1,messages:sampleMessages.map(({label,body})=>({label,body}))}
export const questFixtures={
  A:{...base}, B:{...base,joined:6,availableSeats:0}, C:{...base,messages:[]},
  D:{...base,title:'This Is RM: Full Playlist',countingType:'checklist',progress:3,target:8,joined:8,capacity:8,availableSeats:0,messages:[]},
  E:{...base,title:'This Is RM: Full Playlist',countingType:'checklist',progress:8,target:8,joined:8,capacity:8,availableSeats:0,complete:true,messages:[]},
  F:{...base,progress:500,joined:6,availableSeats:0,complete:true},
}
