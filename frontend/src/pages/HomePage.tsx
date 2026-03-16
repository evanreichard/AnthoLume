import { Link } from 'react-router-dom';
import { useGetHome, useGetDocuments } from '../generated/anthoLumeAPIV1';
import type { GraphDataPoint, LeaderboardData } from '../generated/model';

interface InfoCardProps {
  title: string;
  size: string | number;
  link?: string;
}

function InfoCard({ title, size, link }: InfoCardProps) {
  if (link) {
    return (
      <Link to={link} className="w-full">
        <div className="flex gap-4 w-full p-4 bg-white shadow-lg dark:bg-gray-700 rounded">
          <div className="flex flex-col justify-around dark:text-white w-full text-sm">
            <p className="text-2xl font-bold text-black dark:text-white">{size}</p>
            <p className="text-sm text-gray-400">{title}</p>
          </div>
        </div>
      </Link>
    );
  }
  
  return (
    <div className="w-full">
      <div className="flex gap-4 w-full p-4 bg-white shadow-lg dark:bg-gray-700 rounded">
        <div className="flex flex-col justify-around dark:text-white w-full text-sm">
          <p className="text-2xl font-bold text-black dark:text-white">{size}</p>
          <p className="text-sm text-gray-400">{title}</p>
        </div>
      </div>
    </div>
  );
}

interface StreakCardProps {
  window: 'DAY' | 'WEEK';
  currentStreak: number;
  currentStreakStartDate: string;
  currentStreakEndDate: string;
  maxStreak: number;
  maxStreakStartDate: string;
  maxStreakEndDate: string;
}

function StreakCard({ window, currentStreak, currentStreakStartDate, currentStreakEndDate, maxStreak, maxStreakStartDate, maxStreakEndDate }: StreakCardProps) {
  return (
    <div className="w-full">
      <div className="relative w-full px-4 py-6 bg-white shadow-lg dark:bg-gray-700 rounded">
        <p className="text-sm font-semibold text-gray-700 border-b border-gray-200 w-max dark:text-white dark:border-gray-500">
          {window === 'WEEK' ? 'Weekly Read Streak' : 'Daily Read Streak'}
        </p>
        <div className="flex items-end my-6 space-x-2">
          <p className="text-5xl font-bold text-black dark:text-white">{currentStreak}</p>
        </div>
        <div className="dark:text-white">
          <div className="flex items-center justify-between pb-2 mb-2 text-sm border-b border-gray-200">
            <div>
              <p>{window === 'WEEK' ? 'Current Weekly Streak' : 'Current Daily Streak'}</p>
              <div className="flex items-end text-sm text-gray-400">
                {currentStreakStartDate} ➞ {currentStreakEndDate}
              </div>
            </div>
            <div className="flex items-end font-bold">{currentStreak}</div>
          </div>
          <div className="flex items-center justify-between pb-2 mb-2 text-sm">
            <div>
              <p>{window === 'WEEK' ? 'Best Weekly Streak' : 'Best Daily Streak'}</p>
              <div className="flex items-end text-sm text-gray-400">
                {maxStreakStartDate} ➞ {maxStreakEndDate}
              </div>
            </div>
            <div className="flex items-end font-bold">{maxStreak}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface LeaderboardCardProps {
  name: string;
  data: LeaderboardData;
}

function LeaderboardCard({ name, data }: LeaderboardCardProps) {
  return (
    <div className="w-full">
      <div className="flex flex-col justify-between h-full w-full px-4 py-6 bg-white shadow-lg dark:bg-gray-700 rounded">
        <div>
          <div className="flex justify-between">
            <p className="text-sm font-semibold text-gray-700 border-b border-gray-200 w-max dark:text-white dark:border-gray-500">
              {name} Leaderboard
            </p>
            <div className="flex gap-2 text-xs text-gray-400 items-center">
              <span className="cursor-pointer hover:text-black dark:hover:text-white">all</span>
              <span className="cursor-pointer hover:text-black dark:hover:text-white">year</span>
              <span className="cursor-pointer hover:text-black dark:hover:text-white">month</span>
              <span className="cursor-pointer hover:text-black dark:hover:text-white">week</span>
            </div>
          </div>
        </div>
        
        {/* All time data */}
        <div className="flex items-end my-6 space-x-2">
          {data.all.length === 0 ? (
            <p className="text-5xl font-bold text-black dark:text-white">N/A</p>
          ) : (
            <p className="text-5xl font-bold text-black dark:text-white">{data.all[0]?.user_id || 'N/A'}</p>
          )}
        </div>
        
        <div className="dark:text-white">
          {data.all.slice(0, 3).map((item: any, index: number) => (
            <div 
              key={index} 
              className={`flex items-center justify-between pt-2 pb-2 text-sm ${index > 0 ? 'border-t border-gray-200' : ''}`}
            >
              <div>
                <p>{item.user_id}</p>
              </div>
              <div className="flex items-end font-bold">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GraphVisualization({ data }: { data: GraphDataPoint[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="relative h-24 flex items-center justify-center bg-gray-100 dark:bg-gray-600">
        <p className="text-gray-400 dark:text-gray-300">No data available</p>
      </div>
    );
  }

  // Simple bar visualization (could be enhanced with SVG bezier curve like SSR)
  const maxMinutes = Math.max(...data.map(d => d.minutes_read), 1);
  
  return (
    <div className="relative h-24 flex items-end justify-between p-2 bg-gray-100 dark:bg-gray-600">
      {data.map((point, i) => (
        <div
          key={i}
          className="flex-1 mx-0.5 bg-blue-500 hover:bg-blue-600 transition-colors relative group"
          style={{ height: `${(point.minutes_read / maxMinutes) * 100}%` }}
        >
          <div className="absolute bottom-full mb-1 left-0 w-full text-xs text-center text-gray-600 dark:text-gray-300 opacity-0 group-hover:opacity-100 pointer-events-none">
            {point.minutes_read} min
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { data: homeData, isLoading: homeLoading } = useGetHome();
  const { data: docsData, isLoading: docsLoading } = useGetDocuments({ page: 1, limit: 9 });
  
  const docs = docsData?.data?.documents;
  const dbInfo = homeData?.data?.database_info;
  const streaks = homeData?.data?.streaks?.streaks;
  const graphData = homeData?.data?.graph_data?.graph_data;
  const userStats = homeData?.data?.user_statistics;

  if (homeLoading || docsLoading) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Daily Read Totals Graph */}
      <div className="w-full">
        <div className="relative w-full bg-white shadow-lg dark:bg-gray-700 rounded">
          <p className="absolute top-3 left-5 text-sm font-semibold text-gray-700 border-b border-gray-200 w-max dark:text-white dark:border-gray-500">
            Daily Read Totals
          </p>
          <GraphVisualization data={graphData || []} />
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <InfoCard
          title="Documents"
          size={dbInfo?.documents_size || 0}
          link="./documents"
        />
        <InfoCard
          title="Activity Records"
          size={dbInfo?.activity_size || 0}
          link="./activity"
        />
        <InfoCard
          title="Progress Records"
          size={dbInfo?.progress_size || 0}
          link="./progress"
        />
        <InfoCard
          title="Devices"
          size={dbInfo?.devices_size || 0}
        />
      </div>

      {/* Streak Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {streaks?.map((streak: any, index) => (
          <StreakCard 
            key={index}
            window={streak.window as 'DAY' | 'WEEK'}
            currentStreak={streak.current_streak}
            currentStreakStartDate={streak.current_streak_start_date}
            currentStreakEndDate={streak.current_streak_end_date}
            maxStreak={streak.max_streak}
            maxStreakStartDate={streak.max_streak_start_date}
            maxStreakEndDate={streak.max_streak_end_date}
          />
        ))}
      </div>

      {/* Leaderboard Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <LeaderboardCard 
          name="WPM" 
          data={userStats?.wpm || { all: [], year: [], month: [], week: []}} 
        />
        <LeaderboardCard 
          name="Duration" 
          data={userStats?.duration || { all: [], year: [], month: [], week: []}} 
        />
        <LeaderboardCard 
          name="Words" 
          data={userStats?.words || { all: [], year: [], month: [], week: []}} 
        />
      </div>
      
      {/* Recent Documents */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {docs?.slice(0, 6).map((doc: any) => (
          <div
            key={doc.id}
            className="flex flex-col gap-2 p-4 rounded shadow-lg bg-white dark:bg-gray-700 text-gray-500 dark:text-white"
          >
            <h3 className="font-medium text-lg">{doc.title}</h3>
            <p className="text-sm">{doc.author}</p>
            <Link
              to={`/documents/${doc.id}`}
              className="text-white bg-blue-700 hover:bg-blue-800 font-medium rounded text-sm text-center py-1 dark:bg-blue-600 dark:hover:bg-blue-700"
            >
              View Document
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
